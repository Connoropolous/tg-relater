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
          // use the 'name' property of data as the label of the node
          label: 'data(name)',
        },
      },

      {
        selector: 'edge',
        style: {
          width: 3,
          'line-color': '#ccc',
          'target-arrow-color': '#ccc',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          label: function (edge) {
            return edge.data('strength') + ' ' + edge.data('playerAskedName')
          },
        },
      },
    ],
  })

  let layout = cy.layout({
    name: 'cose',
    // Node repulsion (non overlapping) multiplier
    nodeRepulsion: function (node) {
      return 500000000
    },
    idealEdgeLength: function (edge) {
      return (1 - edge.data('strength')) * 400
    },
    // Divisor to compute edge forces
    edgeElasticity: function (edge) {
      return (1 - edge.data('strength')) * 400
    },
    // Gravity force (constant)
    gravity: 1,
  })
  layout.run()
}

// main function to execute
async function run() {
  // gets a param from the url like
  // ?groupId=hello
  const params = new URLSearchParams(window.location.search)
  const TESTING_MODE = 'default-test'
  const groupId = params.get('groupId') || TESTING_MODE

  // makes an http call to our express js server
  // requesting data
  const res = await fetch(`/data/${groupId}`)
  // parses the json, from a string, into JSON objects
  let cytoscapeData
  try {
    cytoscapeData = await res.json()
  } catch (e) {
    // got a bad response, no data there
    alert(`group with id ${groupId} doesnt exist`)
  }

  // loads our data into the UI
  runCytoscape(cytoscapeData)
}

run()
