const runCytoscape = (cytoscapeData) => {
  cytoscape({
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
        },
      },
    ],
  })
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
