window.app = Vue.createApp({
  el: '#vue',
  mixins: [windowMixin],
  delimiters: ['${', '}'],
  data: function () {
    return {
      // Authentication
      isAuthenticated: false,
      connecting: false,
      userPubkey: null,
      userPrivateKey: null,
      authMethod: 'extension', // 'extension' or 'nsec'
      
      // Nostr
      relays: ['wss://relay.nostriot.com'],
      pool: null,
      
      // IoT Devices
      iotDevices: [],
      loadingDevices: false,
      followList: [],
      
      // UI State
      capabilityStates: new Map(),
      setMethodInputs: {},
      
      // Modals
      invoiceDialog: {
        show: false,
        bolt11: '',
        amount: ''
      },
      relayDialog: {
        show: false,
        url: ''
      },
      nsecDialog: {
        show: false,
        privateKey: ''
      }
    }
  },

  methods: {
    getReadableCapability(capability) {
      // insert a space after 'get', 'set', or 'toggle' if followed by uppercase letter
      return capability.replace(/^(get|set|toggle)(?=[A-Z])/i, '$1 ')
    },

    // Check if capability is a set method
    isSetMethod(capability) {
      return capability.toLowerCase().startsWith('set')
    },

    // Helper method to sign events (works with both extension and nsec)
    async signEvent(event) {
      if (this.authMethod === 'extension') {
        return await window.nostr.signEvent(event)
      } else if (this.authMethod === 'nsec') {
        return window.NostrTools.finalizeEvent(event, this.userPrivateKey)
      } else {
        throw new Error('No authentication method available')
      }
    },
    // Nostr Authentication - Browser Extension
    async connectNostr() {
      this.authMethod = 'extension'
      this.connecting = true
      try {
        if (!window.nostr) {
          throw new Error('Nostr browser extension not found')
        }
        
        this.userPubkey = await window.nostr.getPublicKey()
        this.isAuthenticated = true
        
        // Initialize SimplePool
        this.pool = new window.NostrTools.SimplePool()
        
        // Fetch follow list and devices
        await this.fetchFollowList()
        await this.discoverIoTDevices()
        
        this.$q.notify({
          type: 'positive',
          message: 'Connected to Nostr successfully'
        })
      } catch (error) {
        console.error('Nostr connection failed:', error)
        this.$q.notify({
          type: 'negative',
          message: 'Failed to connect to Nostr: ' + error.message
        })
      }
      this.connecting = false
    },

    // Show nsec dialog
    showNsecDialog() {
      this.nsecDialog.privateKey = ''
      this.nsecDialog.show = true
    },

    // Nostr Authentication - Private Key
    async connectWithNsec() {
      this.authMethod = 'nsec'
      this.connecting = true
      try {
        let privateKey = this.nsecDialog.privateKey.trim()
        
        console.log('Input private key:', privateKey.substring(0, 10) + '...')
        
        // Handle nsec format
        if (privateKey.startsWith('nsec1')) {
          try {
            const decoded = window.NostrTools.nip19.decode(privateKey)
            privateKey = decoded.data
            console.log('Decoded from nsec format')
          } catch (decodeError) {
            console.error('Failed to decode nsec:', decodeError)
            throw new Error('Invalid nsec format')
          }
        }
        
        // Convert to hex string if it's a Uint8Array
        if (privateKey instanceof Uint8Array) {
          privateKey = Array.from(privateKey, byte => byte.toString(16).padStart(2, '0')).join('')
        }
        
        console.log('Final private key format:', typeof privateKey, privateKey.length)
        
        // Validate private key format (64 hex characters)
        if (typeof privateKey !== 'string' || !/^[a-fA-F0-9]{64}$/.test(privateKey)) {
          throw new Error(`Invalid private key format: expected 64 hex chars, got ${privateKey.length} chars`)
        }
        
        // Store private key and generate public key
        this.userPrivateKey = privateKey
        this.userPubkey = window.NostrTools.getPublicKey(privateKey)
        this.isAuthenticated = true
        
        console.log('Generated public key:', this.userPubkey)
        
        // Close dialog
        this.nsecDialog.show = false
        
        // Initialize SimplePool
        this.pool = new window.NostrTools.SimplePool()
        
        // Fetch follow list and devices
        await this.fetchFollowList()
        await this.discoverIoTDevices()
        
        this.$q.notify({
          type: 'positive',
          message: 'Connected with private key successfully'
        })
      } catch (error) {
        console.error('Private key connection failed:', error)
        this.$q.notify({
          type: 'negative',
          message: 'Failed to connect: ' + error.message
        })
      }
      this.connecting = false
    },

    // Relay Management
    addRelay() {
      this.relayDialog.show = true
      this.relayDialog.url = ''
    },

    confirmAddRelay() {
      if (this.relayDialog.url && !this.relays.includes(this.relayDialog.url)) {
        this.relays.push(this.relayDialog.url)
        console.log('Added relay:', this.relayDialog.url)
      }
      this.relayDialog.show = false
    },

    removeRelay(relayUrl) {
      this.relays = this.relays.filter(r => r !== relayUrl)
      console.log('Removed relay:', relayUrl)
    },

    // Fetch user's follow list (NIP-02)
    async fetchFollowList() {
      try {
        const filter = {
          kinds: [3],
          authors: [this.userPubkey],
          limit: 1
        }
        
        const events = await this.pool.querySync(this.relays, filter)
        console.log('Fetched follow list events:', events)
        if (events.length > 0) {
          const followEvent = events[0]
          this.followList = followEvent.tags
            .filter(tag => tag[0] === 'p')
            .map(tag => tag[1])
          console.log('Follow list:', this.followList.length, 'accounts')
        } else {
          console.log('No follow list found')
        }
      } catch (error) {
        console.error('Failed to fetch follow list:', error)
        this.$q.notify({
          type: 'warning',
          message: 'Could not fetch follow list'
        })
      }
    },

    // Discover IoT devices from follow list
    async discoverIoTDevices() {
      if (!this.followList.length) {
        this.$q.notify({
          type: 'info',
          message: 'No follows found. Follow some Nostr accounts that provide IoT services.'
        })
        return
      }

      this.loadingDevices = true
      try {
        // Query for DVM advertisements (kind 31990)
        const filter = {
          kinds: [31990],
          authors: this.followList
        }
        
        const events = await this.pool.querySync(this.relays, filter)
        console.log('Fetched DVM advertisement events:', events)
        this.iotDevices = []
        
        for (const event of events) {
          // Filter for IoT devices (tag 'k' = '5107')
          const kTag = event.tags.find(tag => tag[0] === 'k' && tag[1] === '5107')
          if (kTag) {
            const device = this.parseIoTDevice(event)
            if (device) {
              this.iotDevices.push(device)
            }
          }
        }
        
        console.log('Discovered IoT devices:', this.iotDevices)
        
        if (this.iotDevices.length === 0) {
          this.$q.notify({
            type: 'info',
            message: 'No IoT devices found in your follow list'
          })
        }
      } catch (error) {
        console.error('Failed to discover IoT devices:', error)
        this.$q.notify({
          type: 'negative',
          message: 'Failed to discover IoT devices'
        })
      }
      this.loadingDevices = false
    },

    // Parse IoT device from DVM advertisement
    parseIoTDevice(event) {
      try {
        const content = JSON.parse(event.content)
        const capabilitiesTag = event.tags.find(tag => tag[0] === 't')
        const capabilities = capabilitiesTag ? capabilitiesTag.slice(1) : []
        
        return {
          pubkey: event.pubkey,
          name: content.name || 'Unknown Device',
          about: content.about || 'No description',
          capabilities: capabilities
        }
      } catch (error) {
        console.error('Failed to parse device:', error)
        return null
      }
    },

    // Execute capability (send DVM request) - for get methods
    async executeCapability(device, capability) {
      const stateKey = `${device.pubkey}:${capability}`
      this.setCapabilityState(stateKey, { loading: true })

      const method = JSON.stringify([{ method: capability }])

      try {
        // Create DVM request event (kind 5107)
        const event = {
          kind: 5107,
          content: "",
          tags: [
            ['i',  method, 'text'],
            ['output', 'text/plain'],
            ['relays', ...this.relays],
            ['p', device.pubkey]
          ],
          created_at: Math.floor(Date.now() / 1000),
          pubkey: this.userPubkey
        }
        
        // Sign and publish the event
        const signedEvent = await this.signEvent(event)
        
        // Publish using SimplePool
        await this.pool.publish(this.relays, signedEvent)
        console.log('Published DVM request for capability:', capability)
        
        // Listen for DVM response
        this.listenForDVMResponse(device, capability, signedEvent.id)
        
      } catch (error) {
        console.error('Failed to execute capability:', error)
        this.$q.notify({
          type: 'negative',
          message: 'Failed to execute ' + capability
        })
        this.setCapabilityState(stateKey, { loading: false })
      }
    },

    // Execute set capability with value
    async executeSetCapability(device, capability) {
      const stateKey = `${device.pubkey}:${capability}`
      const inputKey = `${device.pubkey}:${capability}`
      const inputValue = this.setMethodInputs[inputKey]
      
      if (!inputValue) {
        this.$q.notify({
          type: 'warning',
          message: 'Please enter a value'
        })
        return
      }

      this.setCapabilityState(stateKey, { loading: true })

      // Create method object with value
      const method = JSON.stringify([{ method: capability, value: inputValue }])

      try {
        // Create DVM request event (kind 5107)
        const event = {
          kind: 5107,
          content: "",
          tags: [
            ['i',  method, 'text'],
            ['output', 'text/plain'],
            ['relays', ...this.relays],
            ['p', device.pubkey]
          ],
          created_at: Math.floor(Date.now() / 1000),
          pubkey: this.userPubkey
        }
        
        // Sign and publish the event
        const signedEvent = await this.signEvent(event)
        
        // Publish using SimplePool
        await this.pool.publish(this.relays, signedEvent)
        console.log('Published DVM set request for capability:', capability, 'with value:', inputValue)
        
        // Listen for DVM response
        this.listenForDVMResponse(device, capability, signedEvent.id)
        
      } catch (error) {
        console.error('Failed to execute set capability:', error)
        this.$q.notify({
          type: 'negative',
          message: 'Failed to execute ' + capability
        })
        this.setCapabilityState(stateKey, { loading: false })
      }
    },

    // Listen for DVM response
    listenForDVMResponse(device, capability, requestId) {
      const stateKey = `${device.pubkey}:${capability}`
      
      try {
        // Listen for DVM response events (kind 6107)
        const filter = {
          kinds: [6107],
          authors: [device.pubkey],
          '#e': [requestId],
          since: Math.floor(Date.now() / 1000)
        }
        
        // Set up subscription
        const sub = this.pool.subscribe(this.relays, filter, {
          onevent: async (event) => {
            // Clear timeout and close subscription since we got a response
            sub.close()
            clearTimeout(timeoutId)
            
            try {
              console.log('Received DVM response event:', event)
              
              // Check if response contains bolt11 invoice in amount tag (for kind 6107)
              const amountTag = event.tags.find(tag => tag[0] === 'amount')
              if (amountTag && amountTag[2]) {
                // Display invoice QR code (bolt11 is in the 3rd element)
                this.showInvoiceQR(amountTag[2], amountTag[1])
                this.setCapabilityState(stateKey, { 
                  loading: false, 
                  result: `Payment required: ${amountTag[1]} sats` 
                })
              } else {
                // Display response content
                this.invoiceDialog.show = false
                this.setCapabilityState(stateKey, { 
                  loading: false, 
                  result: event.content || 'Success' 
                })
                
                // Optional: Still show notification for important responses
                // if (event.content) {
                //   this.$q.notify({
                //     type: 'positive',
                //     message: `${capability}: ${event.content}`
                //   })
                // }
              }
            } catch (error) {
              console.error('Error processing DVM response:', error)
              this.setCapabilityState(stateKey, { 
                loading: false, 
                result: 'Error processing response' 
              })
            }
          },
          oneose: () => {
            console.log('End of stored events for DVM response')
          }
        })
        
        // Timeout after 30 seconds
        const timeoutId = setTimeout(() => {
          sub.close()
          this.setCapabilityState(stateKey, { 
            loading: false, 
            result: 'Timeout - no response' 
          })
        }, 30000)
        
      } catch (error) {
        console.error('Failed to listen for DVM response:', error)
        this.setCapabilityState(stateKey, { loading: false })
      }
    },

    // Show invoice QR code
    showInvoiceQR(bolt11, amount) {
      try {
        this.invoiceDialog.bolt11 = bolt11
        this.invoiceDialog.amount = amount
        this.invoiceDialog.show = true
        console.log('Showing invoice QR for:', bolt11, 'amount:', amount)
      } catch (error) {
        console.error('Failed to display invoice QR code:', error)
        this.$q.notify({
          type: 'negative',
          message: 'Failed to display invoice QR code'
        })
      }
    },

    // Capability state management
    setCapabilityState(key, state) {
      this.capabilityStates.set(key, state)
      // Force Vue reactivity update
      this.$forceUpdate()
    },

    isCapabilityLoading(pubkey, capability) {
      const state = this.capabilityStates.get(`${pubkey}:${capability}`)
      return state?.loading || false
    },

    getCapabilityResult(pubkey, capability) {
      const state = this.capabilityStates.get(`${pubkey}:${capability}`)
      return state?.result || null
    },


    // Refresh devices
    async refreshDevices() {
      await this.fetchFollowList()
      await this.discoverIoTDevices()
    }
  },

  async created() {
    // Check if required libraries are loaded
    console.log('NostrTools available:', typeof window.NostrTools !== 'undefined')
    console.log('SimplePool available:', typeof window.NostrTools?.SimplePool !== 'undefined')
    console.log('QRCode available:', typeof window.QRCode !== 'undefined')
    console.log('Nostr extension available:', typeof window.nostr !== 'undefined')
  }
})