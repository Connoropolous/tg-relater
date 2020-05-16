function convertGameDataToCytoscape(gameInstance) {
  let cytoscapeData = {
    nodes: gameInstance.players.map((playerId) => {
      const playerData = gameInstance.playerData[playerId]
      const firstName = playerData.first_name ? playerData.first_name : ''
      const lastName = playerData.last_name ? playerData.last_name : ''
      const username = playerData.username ? playerData.username : ''
      return {
        data: {
          id: playerId,
          name: `${firstName} ${lastName} (${username})`,
        },
      }
    }),
    // since its an array of arrays, use `.flat()` to draw all data points
    // up into one single, flat, array
    // TODO: add STRENGTH metadata onto the edge
    edges: gameInstance.data.flat().map((d, index) => ({
      data: {
        id: index,
        source: d.playerAsked.id,
        target: d.playerAskedAbout.id,
      },
    })),
  }

  return cytoscapeData
}

module.exports = convertGameDataToCytoscape
