const { EventEmitter } = require('events')

class AttentionQueue extends EventEmitter {
  constructor(handleItem) {
    super()
    // callbacks
    this.handleItem = handleItem

    // States: running, not running
    this.running = false

    // queue system
    this.ready = []
    this.doing = null
    this.done = []

    // results
    this.results = []
  }
  async startOrResume() {
    this.running = true
    // do the first
    await this.doNext()
  }
  stopOrPause() {
    this.running = false
    // put what you were doing back on to the ready queue
    if (this.doing) {
      this.ready.unshift(this.doing)
      this.doing = null
    }
  }
  async add(item) {
    // put it at the back of the stack
    this.ready.push(item)
    // this would mean they've emptied the ready queue
    if (this.running && !this.doing) {
      // call doNext to get things flowing again
      await this.doNext()
    }
  }
  async doNext() {
    if (this.ready.length) {
      // take the first item of the ready queue into 'doing', and out of the queue
      this.doing = this.ready.shift()
      try {
        const result = await this.handleItem(this.doing, this.ready.length)
        this.done.push(this.doing)
        this.doing = null
        this.results.push(result)
        this.emit(AttentionQueue.RESULT, result)
        // recurse
        await this.doNext()
      } catch (e) {
        // put what you were doing back on to the ready queue
        this.ready.unshift(this.doing)
        this.doing = null
        if (e.message === AttentionQueue.REMOTE_QUIT) {
          this.emit(AttentionQueue.REMOTE_QUIT)
        } else {
          throw e
        }
      }
    } else {
      this.emit(AttentionQueue.HIT_END_OF_QUEUE)
    }
  }
}
// Event type names
AttentionQueue.REMOTE_QUIT = 'remote_quit'
AttentionQueue.RESULT = 'result'
AttentionQueue.HIT_END_OF_QUEUE = 'hit_end_of_queue'

module.exports = AttentionQueue
