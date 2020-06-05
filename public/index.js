const runCytoscape = (cytoscapeData) => {
  let cy = cytoscape({
    container: document.getElementById('container'),
    elements: cytoscapeData,
    style: [
      // the stylesheet for the graph
      {
        selector: 'node',
        style: {
          'background-color': '#666',
          'background-image': 'data(profile)',
          'background-fit': 'cover',
          'font-size': 4,
          // betweennessCentrality = a data value set by a calculation run only once
          // 0 = the minimum value expected of betweennessCentrality for the node
          // 50 = the maximum value to use in the mapping from betweennessCentrality to node size
          // 20 = the number to use when betweennessCentrality is 0
          // 100 = the number to use when betweennessCentrality is 50 or higher
          width: 'mapData(betweennessCentrality, 0, 50, 10, 40)',
          height: 'mapData(betweennessCentrality, 0, 50, 10, 40)',
          // use the 'name' property of data as the label of the node
          label: 'data(name)',
        },
      },

      {
        selector: 'edge',
        style: {
          //width: 3,
          width: function (edge) {
            return edge.data('strength') * 4
          },
          'line-color': '#CCC',
          'target-arrow-color': '#CCC',
          opacity: 0.5,
          'font-size': 2,
          'target-arrow-shape': 'vee',
          'text-rotation': 'autorotate',
          'curve-style': 'bezier',
          label: function (edge) {
            return edge.data('strength') // + ' ' + edge.data('playerAskedName')
          },
        },
      },
    ],
  })

  let layout = cy.layout({
    name: 'cola',
    // // Node repulsion (non overlapping) multiplier
    // nodeRepulsion: function (/* node */) {
    //   return 5000000
    // },
    // /*
    //                         idealEdgeLength: function (edge) {
    //                           // this is how we modify edge length according to the strength data
    //                           // off of an edge. Cool, thx :P
    //                           return (1 - edge.data('strength')) * 400
    //                         },
    //                         */

    // // Divisor to compute edge forces
    // edgeElasticity: function (edge) {
    //   return (1 - edge.data('strength')) * 2000
    // },

    // // Gravity force (constant)
    // gravity: 1,
  })
  layout.run()

  // calculate betweennessCentrality and set that data as values
  // on each individual node
  const betweennessCentrality = cy.nodes().betweennessCentrality({
    weight: function (edge) {
      return edge.data('strength')
    },
    alpha: 1,
  })
  cy.nodes().forEach((node) => {
    const nodeBetweenness = betweennessCentrality.betweenness(`#${node.id()}`)
    node.data('betweennessCentrality', nodeBetweenness)
  })
}

// main function to execute
async function run() {
  // gets a param from the url like
  // ?gameId=hello
  const params = new URLSearchParams(window.location.search)
  const TESTING_MODE = 'default-test'
  const gameId = params.get('gameId') || TESTING_MODE

  // makes an http call to our express js server
  // requesting data
  const res = await fetch(`/data/${gameId}`)
  // parses the json, from a string, into JSON objects
  let cytoscapeData
  try {
    cytoscapeData = await res.json()
  } catch (e) {
    // got a bad response, no data there
    alert(`the game you requested doesn't exist`)
  }

  // loads our data into the UI
  runCytoscape(cytoscapeData)
}

run()
