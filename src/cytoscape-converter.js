function getPlayerName(playerData) {
  const firstName = playerData.first_name ? playerData.first_name : ''
  const lastName = playerData.last_name ? playerData.last_name : ''
  const username = playerData.username ? playerData.username : ''
  return `${firstName} ${lastName} (${username})`
}

async function convertGameDataToCytoscape(telegram, gameInstance) {
  const profilePhotos = []
  for await (let playerId of gameInstance.players) {
    let playerData = gameInstance.playerData[playerId]
    let profilePhoto
    if (!playerData.test) {
      try {
        let pics = await telegram.getUserProfilePhotos(playerId)
        profilePhoto = `/profiles/${pics.photos[0][1].file_id}`
      } catch (e) {}
    }
    // add a default
    profilePhoto =
      profilePhoto ||
      'https://static.independent.co.uk/s3fs-public/thumbnails/image/2015/12/04/15/harry-potter-philosophers-stone.jpg'
    profilePhotos.push(profilePhoto)
  }

  let cytoscapeData = {
    nodes: gameInstance.players.map((playerId, index) => {
      const playerData = gameInstance.playerData[playerId]
      return {
        data: {
          id: playerId,
          name: getPlayerName(playerData),
          profile: profilePhotos[index],
        },
      }
    }),
    edges: gameInstance.edges.map((d, index) => ({
      data: {
        // lesson learned, id for edges should not overlap with ids for nodes
        id: 'edge' + index,
        source: d.playerAsked.id,
        target: d.playerAskedAbout.id,
        strength: d.strength,
        playerAskedAboutName: getPlayerName(d.playerAskedAbout),
        playerAskedName: getPlayerName(d.playerAsked),
      },
    })),
  }

  return cytoscapeData
}

module.exports = convertGameDataToCytoscape
