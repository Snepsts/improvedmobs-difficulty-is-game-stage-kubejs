// type/prop info: https://mappings.dev/1.20.1/index.html

// SCRIPT SETTINGS START HERE
/**
  some quick notes about zombieBaseXpMap:
  crude map impl to track xp value for a killed zombie
  each key is the zombie's tag, and the value is the xp they're worth
  the idea is stronger zombie tags (like minibosses and bosses) will have higher xp
 */
const zombieBaseXpMap = {
  // TODO: fine tune these values and find the other zombie tags present in the mod
  'minecraft:zombie': 1, // basic enemy, low XP
  'mutantmonsters:mutant_zombie': 50, // this thing takes forever to kill wtf, deserves a lot of XP
  'fallbackValue': 1, // this should probably always match the minimum zombie/mutant value to be safe
}

const debugLog = true // enable debug logging for features actively in development
const extraDebugLog = false // enable debug logging for features that are considered "stable" (WARNING: noisy)
const treatMissingImprovedMobsNbtAsZero = true // if the improvedmobs difficulty is 0 it's not present on the user
// SCRIPT SETTINGS END HERE

// TODO: needs optimization probably
// TODO: are IDs reliable (i.e: entity with ID 2145 despawns, is it guaranteed a new entity with ID 2145 doesn't spawn again anytime soon???)
// TODO: Map rest of zombies

// some quick notes about damageMap:
// crude map impl to track entity damage
// each key is the entity's id (TODO: look into if id is truly unique or if we need some sort of "uuid" impl)
// each key points to an object that contains the following:
// previousDamageEvent: an object tracking the player and health value of the previous hurt event
// playerDamageMap: a crude map of player id to damage dealt, we use this to split XP/difficulty increase of a killed entity among players with a proportional percentage of those points applied via damage/max health
const damageMap = {}

// custom debug logger that prints messages to server
function logToServer(msg, extraLog) {
  if (extraLog) {
    if (extraDebugLog) {
      Utils.server.tell(msg)
    }
  } else if (debugLog) {
    Utils.server.tell(msg)
  }
}

// function trackDamage: logic to deal with per-player damage tracking
// arg damageEntity: a top-level entry from the damageMap (i.e: damageMap[event.entity.id])
// arg currentEntityHealth: the current health of the entity
function trackDamage(damageEntity, currentEntityHealth) {
  // workaround for per-player damage tracking
  const previousDamageEventEntityHealth = damageEntity.previousDamageEvent.entityHealth
  const previousDamageEventPlayerId = damageEntity.previousDamageEvent.playerId

  if (previousDamageEventEntityHealth && previousDamageEventPlayerId) {
    // data is present, track
    logToServer('Tracking previous damage', true)
    const damage = previousDamageEventEntityHealth - currentEntityHealth
    damageEntity.playerDamageMap[previousDamageEventPlayerId] += damage
    if (damage !== 0) {
      logToServer(`Player with ID ${previousDamageEventPlayerId} dealt ${damage} damage last hit${currentEntityHealth === 0 ? ' for the killing blow.' : '.'}`)
    }
  } else { // not present, hopefully first time damaging
    if (!previousDamageEventPlayerId) {
      logToServer('No previous damage player id on object, damage may have been caused by a non-player. Not tracking.', true)
    }
    if (!previousDamageEventEntityHealth) {
      logToServer('No previous entity health on object, if map was not just initialized this could be a bug.', true)
    }
  }
}

// function initializeEntityDamageMap: logic to initialze an entity in the damageMap
// arg entityId: the id of the entity being damaged (i.e: event.entity.id)
function initializeEntityDamageMap(entityId) {
  if (!damageMap[entityId]) {
    logToServer(`First time damage for entity with ID ${entityId}, creating map entry.`, true)
    damageMap[entityId] = { previousDamageEvent: {}, playerDamageMap: {} }
  }
}

// function initializePlayerDamage: logic to initialize per-player damage tracking
// arg damageEntity: a top-level entry from the damageMap (i.e: damageMap[event.entity.id])
// arg playerId: the id of the player dealing the damage
function initializePlayerDamage(damageEntity, playerId) {
  if (!damageEntity.playerDamageMap[playerId]) { // initialize player damage map
    logToServer(`First time damage from player with ID ${playerId}, adding to map.`, true)
    damageEntity.playerDamageMap[playerId] = 0
  }
}

// function shouldSkipDamageCheck: function that returns true if the event shouldn't be processed for damage tracking
// arg event: the EntityEvents.hurt event
function shouldSkipDamageCheck(event) {
  const playerWasDamaged = Boolean(event.getPlayer())
  const nonZombieAttacked = !isZombie(event.entity)

  if (playerWasDamaged) {
    logToServer('Player damage event detected', true)
  } else if (nonZombieAttacked) {
    logToServer('Entity damaged is not a zombie', true)
  }

  return playerWasDamaged || nonZombieAttacked
}

// function shouldSkipKillCheck: function that returns true if the event shouldn't be processed for kill tracking
// arg event: the EntityEvents.kill event
function shouldSkipKillCheck(event) {
  const entityIsNotZombie = !isZombie(event.entity)
  const damageEntity = damageMap[event.entity.id]
  const notTrackingEntity = !damageEntity

  if (entityIsNotZombie) {
    logToServer('Kill check entity isn\'t a zombie', true)
  } else if (notTrackingEntity) {
    logToServer('Kill check entity is a zombie, but isn\'t being tracked', true)
    logToServer('This is probably an error...', true)
  }

  return entityIsNotZombie || notTrackingEntity
}

// function isZombie: returns true if entity is a zombie, otherwise false
// arg entity: the entity being checked for zombie status (i.e: event.entity)
function isZombie(entity) {
  const entityTag = entity.type.toString()
  // TODO: it's very likely the below needs a little tweaking to account for zombies without "zombie" in their tag
  return entityTag.includes('zombie')
}

// function getZombieBaseXp: simple getter with conservative fallback value for any tags not supported yet
// arg zombieTag: the entity (zombie) tag (i.e: event.entity.type.toString())
function getZombieBaseXp(zombieTag) {
  logToServer(`Searching for ${zombieTag} in zombie map`, true)
  const difficultyValue = zombieBaseXpMap[zombieTag]
  return difficultyValue || zombieBaseXpMap.fallbackValue
}

// function increaseDifficultyForPlayer: Runs the command to increase difficulty
// arg killedEntity: killed entity's object (i.e: event.entity)
// arg server: server object (i.e: event.server)
// arg player: Player to increase difficulty of (i.e: event.player)
// arg modifier: Value between 0-1 to multiply base difficulty value by to arrive at the final value
function increaseDifficultyForPlayer(killedEntity, server, player, modifier) {
  const playerLevelInfo = getLevelObject(player)
  if (!playerLevelInfo) {
    logToServer('Cannot increase XP of player because there is no improved mobs NBT data on the player.')
    return
  }
  const zombieTag = killedEntity.type.toString()
  const zombieBaseXp = getZombieBaseXp(zombieTag) // get base XP for this entity
  // TODO: Adjust XP with a multiplier based on the zombie's equipment
  const levelAdjustedXp = zombieBaseXp / playerLevelInfo.totalXpRequiredForNextLevel
  const finalDifficultyIncreaseValue = levelAdjustedXp * modifier

  // debug leveling system
  logToServer(`Base XP to be rewarded: ${zombieBaseXp}`)
  logToServer(`XP converted to progress: ${levelAdjustedXp}`)
  logToServer(`Damage % of kill adjustment: ${finalDifficultyIncreaseValue}`)

  // "award" XP
  server.runCommandSilent(`improvedmobs difficulty player ${player.username} add ${finalDifficultyIncreaseValue}`)

  // log the user's progress for debugging purposes
  const newProgress = playerLevelInfo.progress + finalDifficultyIncreaseValue
  let finalProgress
  if (newProgress > 1) { // level-up
    finalProgress = newProgress - 1
    playerLevelInfo.level++
  } else {
    finalProgress = newProgress
  }
  logToServer(`${player.username} is level ${playerLevelInfo.level} and is ${finalProgress * 100}% of the way to the next level`)
}

// function getImprovedMobsDifficultyFromPlayer: Gets numeric value of player's current improvedmobs difficulty
// arg player: the player object (i.e: event.player)
function getImprovedMobsDifficultyFromPlayer(player) {
  let difficulty = treatMissingImprovedMobsNbtAsZero ? 0 : null
  try {
    let fetchedDifficulty = Number(player.nbt.ForgeCaps['improvedmobs:player_cap'].IMDifficulty)
    difficulty = fetchedDifficulty
  } catch (err) {
    logToServer(`Getting difficulty for player with id ${player.id} & username ${player.username} failed. Err: ${err.message}`)
  }

  return difficulty
}

// function getLevelObject: Gets level data for player based on their improvedmobs difficulty value
// arg player: a player object (i.e: event.player)
function getLevelObject(player) {
  const improvedMobsDifficulty = getImprovedMobsDifficultyFromPlayer(player)
  if (improvedMobsDifficulty === null) {
    logToServer(`Failed to grab level object for player with ID ${player.id} and name ${player.name}`)
    return null
  }

  console.log(improvedMobsDifficulty)

  const [levelStr, progressStr] = String(improvedMobsDifficulty).split('.')
  const level = Number(levelStr)
  const progress = progressStr === undefined ? 0 : Number(`0.${progressStr}`)

  const totalXpRequiredForNextLevel = getXpRequiredForLevel(level)

  logToServer(`Fetching ${player.username}'s level data. Progress: ${progress}, level: ${level}, totalXpRequiredForNextLevel: ${totalXpRequiredForNextLevel}`, true)

  return { level: level, progress: progress, totalXpRequiredForNextLevel: totalXpRequiredForNextLevel }
}

// function getXpRequiredForLevel: algorithm to calculate XP needed to level up for a given integer level (VERY SUBJECT TO CHANGE)
// arg currentLevel: level to calculate the Xp for
function getXpRequiredForLevel(currentLevel) {
  const x = currentLevel + 5
  return x * Math.log2(x)
}

// wrapper to fix crashes on game startup
try {
  logToServer('Hello, World! (Loaded server scripts)')
} catch (err) {
  // swallow error, log not working on world start shouldn't crash the script
}

// function to help figure out object props in the dark, obj is js object, requiredSubStrings is an array of strings (should be all lowercase)
function logPropsFromObj(obj, requiredSubStrings) { // eslint-disable-line no-unused-vars
  if (!obj) {
    logToServer('logPropsFromObj failed cuz obj don\'t exist')
    return
  }

  if (!requiredSubStrings)
    requiredSubStrings = []
  let msg = ''
  for (const key in obj) {
    if (requiredSubStrings.length === 0 || requiredSubStrings.some(subStr => key.toLowerCase().includes(subStr))) {
      msg += `${key} `
    }
  }

  logToServer('Object props:')
  logToServer(msg)
}

EntityEvents.hurt((event) => {
  // const entityTag = event.entity.type.toString()
  // Utils.server.tell(`Hello! A(n) ${entityTag} has been hurt!`)

  if (shouldSkipDamageCheck(event)) {
    return // early terminate
  }

  initializeEntityDamageMap(event.entity.id)

  const damageSource = event.source
  const damageEntity = damageMap[event.entity.id]
  const player = damageSource.immediate
  const playerId = player ? player.id : null
  if (!player) {
    logToServer('Damage not from player', true)
    initializePlayerDamage(damageEntity, 'non-player')
  } else {
    initializePlayerDamage(damageEntity, playerId)
  }

  trackDamage(damageEntity, event.entity.health)

  // set data for next damage event
  damageEntity.previousDamageEvent.playerId = playerId || 'non-player'
  damageEntity.previousDamageEvent.entityHealth = event.entity.health
})

EntityEvents.death((event) => {
  const entityTag = event.entity.type.toString()
  logToServer(`A(n) ${entityTag} has been merc'd!`)

  if (shouldSkipKillCheck(event)) {
    logToServer('Skipping kill check', true)
    return // early terminate
  }

  const damageEntity = damageMap[event.entity.id]
  trackDamage(damageEntity, 0)

  const playerKillContributionMap = {}
  const entityMaxHealth = event.entity.maxHealth
  for (const playerId in damageEntity.playerDamageMap) {
    playerKillContributionMap[playerId] = damageEntity.playerDamageMap[playerId] / entityMaxHealth
  }

  const players = event.server.players
  for (const playerId in playerKillContributionMap) {
    logToServer(`Player with ID ${playerId} contributed to ${playerKillContributionMap[playerId] * 100}% of that kill`)
    let player = null
    for (const playerKey in players) {
      if (Number(players[playerKey].id) === Number(playerId)) {
        player = players[playerKey]
      }
    }

    if (!player) {
      logToServer(`Couldn't find player with ID ${playerId}, skipping improved mobs command.`)
      continue // skip trying to run command if can't find player
    }

    try {
      increaseDifficultyForPlayer(event.entity, event.server, player, playerKillContributionMap[playerId])
    } catch (err) {
      logToServer(`Encountered error trying to increase mob difficulty for player with ID ${playerId}: ${err.message}.`)
    }
  }

  // clean up data
  delete damageMap[event.entity.id]
})

// the following code will help keep the damageMap clean and prevent memory issues (well, :) hopefully)
// default is 8000, or 3 times a day
// TODO: Should default be less often? More often?
const garbageCollectionTickCount = 8000
ServerEvents.tick((event) => {
  if (event.server.getTickCount() % garbageCollectionTickCount === 0) {
    logToServer('Cleaning damageMap for despawned entities.', true)
    const entities = event.server.entities
    const serverIdList = []
    for (const entityKey in entities) {
      // NOTE: for some reason const doesn't seem to work in a loop (could just be dupe var name)
      // const entityId = Number(entities[entityKey].id)
      serverIdList.push(Number(entities[entityKey].id))
    }

    const trackedIdList = []
    const idsToKeep = []
    const idsToRemove = []
    for (const entityId in damageMap) {
      trackedIdList.push(entityId)
      if (serverIdList.includes(Number(entityId))) {
        idsToKeep.push(Number(entityId))
      } else {
        idsToRemove.push(Number(entityId))
      }
    }
    logToServer(`Tracked ID list: ${trackedIdList.join(' ')}`, true)
    logToServer(`ID list to keep: ${idsToKeep.join(' ')}`, true)
    logToServer(`ID list to remove: ${idsToRemove.join(' ')}`, true)

    for (const idToRemove of idsToRemove) {
      delete damageMap[idToRemove]
    }

    const updatedTrackedIdList = Object.keys(damageMap)
    logToServer(`Updated Tracked ID list: ${updatedTrackedIdList.join(' ')}`, true)
  }
})
