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
      // Default contact list relays
      contactListRelays: [
        'wss://relay.nostriot.com',
        'wss://relay.damus.io',
        'wss://nos.lol',
        'wss://relay.nostr.band',
        'wss://purplepag.es'
      ],
      pool: null,
      globalDVMSubscription: null,
      pendingRequests: new Map(), // Track pending DVM requests

      // IoT Devices
      iotDevices: [],
      loadingDevices: true,
      followList: [],

      // Explore Service Providers
      showExploreView: false,
      serviceProviders: [],
      loadingProviders: false,
      followingStates: {}, // Track follow button loading states
      searchTerm: '',

      // UI State
      capabilityStates: new Map(),
      setMethodInputs: {},

      // Modals
      invoiceDialog: {
        show: false,
        bolt11: '',
        amount: '',
        paymentLoading: false
      },
      selectedWallet: null,
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

  computed: {
    filteredProviders() {
      if (!this.searchTerm) {
        return this.serviceProviders
      }

      const term = this.searchTerm.toLowerCase()
      return this.serviceProviders.filter(
        provider =>
          provider.name.toLowerCase().includes(term) ||
          provider.about.toLowerCase().includes(term) ||
          provider.capabilities.some(cap => cap.toLowerCase().includes(term))
      )
    },

    exploreButtonLabel() {
      return this.showExploreView
        ? 'Show Your Devices'
        : 'Explore IoT Service Providers'
    }
  },

  methods: {
    getReadableCapability(capability) {
      let spaced = capability.replace(/([a-z])([A-Z])/g, '$1 $2')
      return spaced.charAt(0).toUpperCase() + spaced.slice(1)
    },

    // Check if capability is a set method
    isSetMethod(capability) {
      return capability.toLowerCase().startsWith('set')
    },

    // Utility methods for explore view
    formatPubkey(pubkey) {
      return window.NostrTools.nip19.npubEncode(pubkey)
    },

    formatDate(timestamp) {
      // return as time ago
      const timeDiff = Date.now() / 1000 - timestamp
      if (Math.floor(timeDiff) == 1) return '1 second ago'
      if (timeDiff < 60) return `${Math.floor(timeDiff)} seconds ago`
      if (Math.floor(timeDiff / 60) == 1) return '1 minute ago'
      if (timeDiff < 3600) return `${Math.floor(timeDiff / 60)} minutes ago`
      if (Math.floor(timeDiff / 3600) == 1) return '1 hour ago'
      if (timeDiff < 86400) return `${Math.floor(timeDiff / 3600)} hours ago`
      if (Math.floor(timeDiff / 86400) == 1) return '1 day ago'
      return `${Math.floor(timeDiff / 86400)} days ago`
    },

    isFollowing(pubkey) {
      return this.followList.includes(pubkey)
    },

    getMoreCapabilitiesLabel(capabilities) {
      const remaining = capabilities.length - 6
      return `+${remaining} more`
    },

    // Toggle explore view
    toggleExploreView() {
      this.showExploreView = !this.showExploreView
      if (this.showExploreView && this.serviceProviders.length === 0) {
        this.discoverServiceProviders()
      }
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

    // Save authentication state to localStorage
    saveAuthState() {
      const authState = {
        method: this.authMethod,
        pubkey: this.userPubkey,
        timestamp: Date.now()
      }

      // Only save private key for nsec method
      if (this.authMethod === 'nsec' && this.userPrivateKey) {
        authState.privateKey = this.userPrivateKey
      }

      localStorage.setItem('nostriot_auth', JSON.stringify(authState))
    },

    // Load authentication state from localStorage
    loadAuthState() {
      try {
        const stored = localStorage.getItem('nostriot_auth')
        if (!stored) return null

        const authState = JSON.parse(stored)

        // Check if auth is older than 30 days
        if (Date.now() - authState.timestamp > 30 * 24 * 60 * 60 * 1000) {
          this.clearAuthState()
          return null
        }

        return authState
      } catch (error) {
        console.error('Failed to load auth state:', error)
        this.clearAuthState()
        return null
      }
    },

    // Clear authentication state
    clearAuthState() {
      localStorage.removeItem('nostriot_auth')
      this.authMethod = null
      this.userPubkey = null
      this.userPrivateKey = null
      this.isAuthenticated = false
      this.iotDevices = []
      this.followList = []
      if (this.globalDVMSubscription) {
        this.globalDVMSubscription.close()
        this.globalDVMSubscription = null
      }
      if (this.pool) {
        this.pool.close()
        this.pool = null
      }
      this.pendingRequests.clear()
    },

    // Auto-login on page load
    async autoLogin() {
      const authState = this.loadAuthState()
      if (!authState) return

      try {
        if (authState.method === 'extension') {
          // Check if browser extension is still available
          if (!window.nostr) {
            this.clearAuthState()
            return
          }

          // Verify the extension still has the same pubkey
          const currentPubkey = await window.nostr.getPublicKey()
          if (currentPubkey !== authState.pubkey) {
            this.clearAuthState()
            return
          }

          this.authMethod = 'extension'
          this.userPubkey = authState.pubkey
          this.isAuthenticated = true
        } else if (authState.method === 'nsec') {
          if (!authState.privateKey) {
            this.clearAuthState()
            return
          }

          this.authMethod = 'nsec'
          this.userPrivateKey = authState.privateKey
          this.userPubkey = authState.pubkey
          this.isAuthenticated = true
        }

        // Initialize SimplePool and fetch data
        this.pool = new window.NostrTools.SimplePool()
        this.setupGlobalDVMSubscription()
        await this.fetchFollowList()
        await this.discoverIoTDevices()

        this.$q.notify({
          type: 'positive',
          message: `Auto-logged in with ${authState.method}`
        })
      } catch (error) {
        console.error('Auto-login failed:', error)
        this.clearAuthState()
        this.$q.notify({
          type: 'warning',
          message: 'Auto-login failed, please reconnect'
        })
      }
    },

    // Logout function
    logout() {
      this.clearAuthState()
      this.$q.notify({
        type: 'info',
        message: 'Logged out successfully'
      })
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
        this.setupGlobalDVMSubscription()

        // Save auth state
        this.saveAuthState()

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

        // Handle nsec format
        if (privateKey.startsWith('nsec1')) {
          try {
            const decoded = window.NostrTools.nip19.decode(privateKey)
            privateKey = decoded.data
          } catch (decodeError) {
            console.error('Failed to decode nsec:', decodeError)
            throw new Error('Invalid nsec format')
          }
        }

        // Convert to hex string if it's a Uint8Array
        if (privateKey instanceof Uint8Array) {
          privateKey = Array.from(privateKey, byte =>
            byte.toString(16).padStart(2, '0')
          ).join('')
        }

        // Validate private key format (64 hex characters)
        if (
          typeof privateKey !== 'string' ||
          !/^[a-fA-F0-9]{64}$/.test(privateKey)
        ) {
          throw new Error(
            `Invalid private key format: expected 64 hex chars, got ${privateKey.length} chars`
          )
        }

        // Store private key and generate public key
        this.userPrivateKey = privateKey
        this.userPubkey = window.NostrTools.getPublicKey(privateKey)
        this.isAuthenticated = true

        // Close dialog
        this.nsecDialog.show = false

        // Initialize SimplePool
        this.pool = new window.NostrTools.SimplePool()
        this.setupGlobalDVMSubscription()

        // Save auth state
        this.saveAuthState()

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
      }
      this.relayDialog.show = false
    },

    removeRelay(relayUrl) {
      this.relays = this.relays.filter(r => r !== relayUrl)
    },

    // Fetch user's follow list (NIP-02)
    async fetchFollowList() {
      try {
        const followEvent = await this.fetchContactListsFromMultipleRelays()

        if (followEvent) {
          this.followList = followEvent.tags
            .filter(tag => tag[0] === 'p')
            .map(tag => tag[1])
        } else {
          this.followList = []
        }
      } catch (error) {
        console.error('Failed to fetch follow list:', error)
        this.$q.notify({
          type: 'warning',
          message: 'Could not fetch follow list'
        })
      }
    },

    // Fetch contact lists from multiple relays and merge them
    async fetchContactListsFromMultipleRelays() {
      try {
        const filter = {
          kinds: [3],
          authors: [this.userPubkey],
          limit: 10 // Get multiple versions to find the most recent
        }

        // Fetch from all contact list relays concurrently
        const relayPromises = this.contactListRelays.map(async relay => {
          try {
            const events = await this.pool.querySync([relay], filter)
            return {relay, events}
          } catch (error) {
            console.warn(`Failed to fetch from relay ${relay}:`, error)
            return {relay, events: []}
          }
        })

        const relayResults = await Promise.all(relayPromises)

        // Collect all contact list events from all relays
        const allEvents = []
        relayResults.forEach(result => {
          result.events.forEach(event => {
            allEvents.push({...event, sourceRelay: result.relay})
          })
        })

        if (allEvents.length === 0) {
          return null
        }

        // Sort by created_at to find the most recent contact list
        allEvents.sort((a, b) => b.created_at - a.created_at)
        const mostRecentEvent = allEvents[0]

        // Merge all 'p' tags from all events to avoid losing follows
        const allFollows = new Set()
        const allContactData = new Map() // Store contact metadata (names, etc.)

        allEvents.forEach(event => {
          event.tags.forEach(tag => {
            if (tag[0] === 'p') {
              allFollows.add(tag[1])
              // Store contact metadata if available
              if (tag[2] || tag[3]) {
                allContactData.set(tag[1], {
                  relayUrl: tag[2] || '',
                  name: tag[3] || ''
                })
              }
            }
          })
        })

        // Create merged contact list based on most recent event structure
        const mergedContactList = {
          ...mostRecentEvent,
          tags: Array.from(allFollows).map(pubkey => {
            const contactData = allContactData.get(pubkey)
            if (contactData && (contactData.relayUrl || contactData.name)) {
              return ['p', pubkey, contactData.relayUrl, contactData.name]
            }
            return ['p', pubkey]
          })
        }

        return mergedContactList
      } catch (error) {
        console.error(
          'Failed to fetch contact lists from multiple relays:',
          error
        )
        return null
      }
    },

    // Publish contact list to multiple relays
    async publishContactListToMultipleRelays(signedEvent) {
      const publishPromises = this.contactListRelays.map(async relay => {
        try {
          await this.pool.publish([relay], signedEvent)
          return {relay, success: true}
        } catch (error) {
          console.warn(`Failed to publish contact list to ${relay}:`, error)
          return {relay, success: false, error}
        }
      })

      const results = await Promise.all(publishPromises)
      const successful = results.filter(r => r.success).length
      const failed = results.filter(r => !r.success).length

      if (successful === 0) {
        throw new Error('Failed to publish contact list to any relay')
      }

      return results
    },

    // Discover IoT devices from follow list
    async discoverIoTDevices() {
      if (!this.followList.length) {
        this.$q.notify({
          type: 'info',
          message:
            'No follows found. Follow some Nostr accounts that provide IoT services.'
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

        this.iotDevices = []

        for (const event of events) {
          // Filter for IoT devices (tag 'k' = '5107')
          const kTag = event.tags.find(
            tag => tag[0] === 'k' && tag[1] === '5107'
          )
          if (kTag) {
            const device = this.parseIoTDevice(event)
            if (
              device &&
              !this.iotDevices.some(d => d.pubkey === device.pubkey)
            ) {
              this.iotDevices.push(device)
            }
          }
        }

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
        const lastSeen = event.created_at

        return {
          pubkey: event.pubkey,
          name: content.name || 'Unknown Device',
          about: content.about || 'No description',
          capabilities: capabilities,
          lastSeen: lastSeen
        }
      } catch (error) {
        console.error('Failed to parse device:', error)
        return null
      }
    },

    // Execute capability (send DVM request) - for get methods
    async executeCapability(device, capability) {
      const stateKey = `${device.pubkey}:${capability}`
      this.setCapabilityState(stateKey, {loading: true})

      const method = JSON.stringify([{method: capability}])

      try {
        // Create DVM request event (kind 5107)
        const event = {
          kind: 5107,
          content: '',
          tags: [
            ['i', method, 'text'],
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

        // Register request for global subscription handling
        this.pendingRequests.set(signedEvent.id, {
          device,
          capability,
          stateKey,
          timestamp: Date.now()
        })

        // Set up timeout for request cleanup
        setTimeout(() => {
          if (this.pendingRequests.has(signedEvent.id)) {
            console.warn('Request timeout for capability:', capability)
            this.pendingRequests.delete(signedEvent.id)
            this.setCapabilityState(stateKey, {
              loading: false,
              result: null
            })
          }
        }, 30000) // 30 second timeout
      } catch (error) {
        console.error('Failed to execute capability:', error)
        this.$q.notify({
          type: 'negative',
          message: 'Failed to execute ' + capability
        })
        this.setCapabilityState(stateKey, {loading: false})
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

      this.setCapabilityState(stateKey, {loading: true})

      // Create method object with value
      const method = JSON.stringify([{method: capability, value: inputValue}])

      try {
        // Create DVM request event (kind 5107)
        const event = {
          kind: 5107,
          content: '',
          tags: [
            ['i', method, 'text'],
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

        // Register request for global subscription handling
        this.pendingRequests.set(signedEvent.id, {
          device,
          capability,
          stateKey,
          timestamp: Date.now()
        })

        // Set up timeout for request cleanup
        setTimeout(() => {
          if (this.pendingRequests.has(signedEvent.id)) {
            console.warn('Request timeout for capability:', capability)
            this.pendingRequests.delete(signedEvent.id)
            this.setCapabilityState(stateKey, {
              loading: false,
              result: null
            })
          }
        }, 30000) // 30 second timeout
      } catch (error) {
        console.error('Failed to execute set capability:', error)
        this.$q.notify({
          type: 'negative',
          message: 'Failed to execute ' + capability
        })
        this.setCapabilityState(stateKey, {loading: false})
      }
    },

    // Setup global DVM subscription for all 6107 responses
    setupGlobalDVMSubscription() {
      if (!this.pool || this.globalDVMSubscription) return

      try {
        // Subscribe to all 6107 events since now
        const filter = {
          kinds: [6107],
          since: Math.floor(Date.now() / 1000)
        }

        this.globalDVMSubscription = this.pool.subscribe(this.relays, filter, {
          onevent: event => {
            this.handleDVMResponse(event)
          },
          oneose: () => {},
          onclose: reason => {
            // Attempt to reconnect after a delay if not manually closed
            if (reason !== 'manual' && this.isAuthenticated) {
              setTimeout(() => {
                if (this.isAuthenticated && !this.globalDVMSubscription) {
                  this.setupGlobalDVMSubscription()
                }
              }, 5000)
            }
          }
        })
      } catch (error) {
        console.error('Failed to setup global DVM subscription:', error)
      }
    },

    // Handle incoming DVM responses
    handleDVMResponse(event) {
      try {
        // Validate event structure
        if (!event || !event.kind || event.kind !== 6107) {
          console.warn('Invalid event structure:', event)
          return
        }

        // Find the request ID this response is for
        const eventTag = event.tags.find(tag => tag[0] === 'e')
        if (!eventTag || !eventTag[1]) {
          console.warn('No request ID found in response event')
          return
        }

        const requestId = eventTag[1]
        const pendingRequest = this.pendingRequests.get(requestId)

        if (!pendingRequest) {
          return
        }

        // Process the response
        this.processDVMResponse(event, pendingRequest)
      } catch (error) {
        console.error('Error handling DVM response:', error)
      }
    },

    // Process DVM response for a specific request
    processDVMResponse(event, pendingRequest) {
      const {device, capability, stateKey} = pendingRequest

      try {
        // Check if response contains bolt11 invoice in amount tag (for kind 6107)
        const amountTag = event.tags.find(tag => tag[0] === 'amount')
        if (amountTag && amountTag[2]) {
          // Payment required - keep request pending for actual response after payment
          this.showInvoiceQR(amountTag[2], amountTag[1])
          this.setCapabilityState(stateKey, {
            loading: true, // Keep loading state since we're waiting for final response
            result: `Payment required: ${amountTag[1]} sats`
          })
          // DO NOT remove from pendingRequests - we still need to wait for final response
        } else {
          // Remove from pending requests
          this.pendingRequests.delete(event.tags.find(tag => tag[0] === 'e')[1])

          // Clear any payment dialog
          this.invoiceDialog.show = false

          // Update capability state with result
          this.setCapabilityState(stateKey, {
            loading: false,
            result: event.content || 'Success'
          })
        }
      } catch (error) {
        console.error('Error processing DVM response:', error)
        this.setCapabilityState(stateKey, {
          loading: false,
          result: 'Error processing response'
        })
        // Remove from pending requests on error
        this.pendingRequests.delete(event.tags.find(tag => tag[0] === 'e')[1])
      }
    },

    // Show invoice QR code
    showInvoiceQR(bolt11, amount) {
      try {
        this.invoiceDialog.bolt11 = bolt11
        this.invoiceDialog.amount = amount
        this.invoiceDialog.paymentLoading = false
        this.invoiceDialog.show = true

        // Set default wallet if none selected and wallets are available (LNbits users only)
        if (
          !this.selectedWallet &&
          this.g &&
          this.g.user &&
          this.g.user.wallets &&
          this.g.user.wallets.length > 0
        ) {
          this.selectedWallet = this.g.user.wallets[0].id
        }
      } catch (error) {
        console.error('Failed to display invoice QR code:', error)
        this.$q.notify({
          type: 'negative',
          message: 'Failed to display invoice QR code'
        })
      }
    },

    // Pay invoice with LNbits wallet
    async payWithLNbits() {
      if (!this.selectedWallet) {
        this.$q.notify({
          type: 'warning',
          message: 'Please select a wallet first'
        })
        return
      }

      this.invoiceDialog.paymentLoading = true

      try {
        // Find the selected wallet object to get the admin key
        const wallet = this.g.user.wallets.find(
          w => w.id === this.selectedWallet
        )
        if (!wallet) {
          throw new Error('Selected wallet not found')
        }

        const response = await LNbits.api.request(
          'POST',
          '/nostriotdashboard/api/v1/pay-invoice',
          wallet.adminkey, // Use the wallet's admin key for authentication
          {
            bolt11: this.invoiceDialog.bolt11,
            amount: parseInt(this.invoiceDialog.amount)
          }
        )

        if (response.data.success) {
          this.$q.notify({
            type: 'positive',
            message: 'Payment successful!',
            timeout: 3000
          })

          // Close the invoice dialog
          this.invoiceDialog.show = false
        } else {
          throw new Error(response.data.error || 'Payment failed')
        }
      } catch (error) {
        console.error('Payment failed:', error)

        // Extract error message from API response
        let errorMessage = 'Payment failed'

        if (
          error.response &&
          error.response.data &&
          error.response.data.detail
        ) {
          // Handle 400 errors with detail message
          errorMessage = error.response.data.detail
        } else if (error.message) {
          errorMessage = `Payment failed: ${error.message}`
        } else if (typeof error === 'string') {
          errorMessage = `Payment failed: ${error}`
        }

        this.$q.notify({
          type: 'negative',
          message: errorMessage,
          timeout: 5000
        })
      } finally {
        this.invoiceDialog.paymentLoading = false
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

    // Discover all IoT service providers from the network
    async discoverServiceProviders() {
      this.loadingProviders = true
      try {
        const since = Math.floor(Date.now() / 1000) - 60 * 60 * 6 // 6 hours ago
        const filter = {
          kinds: [31990],
          since: since
        }

        const events = await this.pool.querySync(this.relays, filter)

        // Deduplicate by pubkey (keep most recent per author)
        const providerMap = new Map()
        for (const event of events) {
          // Filter for IoT devices (tag 'k' = '5107')
          const kTag = event.tags.find(
            tag => tag[0] === 'k' && tag[1] === '5107'
          )
          if (kTag) {
            const existing = providerMap.get(event.pubkey)
            if (!existing || event.created_at > existing.created_at) {
              providerMap.set(event.pubkey, event)
            }
          }
        }

        // Parse providers and sort by most recent
        this.serviceProviders = []
        for (const event of providerMap.values()) {
          const provider = this.parseServiceProvider(event)
          if (provider) {
            this.serviceProviders.push(provider)
          }
        }

        // Sort by most recent first
        this.serviceProviders.sort((a, b) => b.created_at - a.created_at)

        if (this.serviceProviders.length === 0) {
          this.$q.notify({
            type: 'info',
            message: 'No IoT service providers found in the past week'
          })
        }
      } catch (error) {
        console.error('Failed to discover service providers:', error)
        this.$q.notify({
          type: 'negative',
          message: 'Failed to discover service providers'
        })
      }
      this.loadingProviders = false
    },

    // Parse service provider from DVM advertisement
    parseServiceProvider(event) {
      try {
        const content = JSON.parse(event.content)
        const capabilitiesTag = event.tags.find(tag => tag[0] === 't')
        const capabilities = capabilitiesTag ? capabilitiesTag.slice(1) : []

        return {
          pubkey: event.pubkey,
          name: content.name || 'Unknown Service',
          about: content.about || 'No description available',
          capabilities: capabilities,
          created_at: event.created_at
        }
      } catch (error) {
        console.error('Failed to parse service provider:', error)
        return null
      }
    },

    // Follow a service provider
    async followProvider(provider) {
      if (this.followingStates[provider.pubkey]) return // Already following

      this.followingStates[provider.pubkey] = true

      try {
        // Fetch current follow list from multiple relays
        const followEvent = await this.fetchContactListsFromMultipleRelays()
        let existingTags = []

        if (followEvent) {
          existingTags = followEvent.tags.filter(tag => tag[0] === 'p')
        }

        // Check if already following
        if (existingTags.some(tag => tag[1] === provider.pubkey)) {
          this.$q.notify({
            type: 'info',
            message: 'Already following this provider'
          })
          this.followList.push(provider.pubkey)
          return
        }

        // Add new provider to follow list
        const newTags = [...existingTags, ['p', provider.pubkey]]

        // Create updated follow list event
        const newFollowEvent = {
          kind: 3,
          content: followEvent?.content || '',
          tags: newTags,
          created_at: Math.floor(Date.now() / 1000),
          pubkey: this.userPubkey
        }

        // Sign and publish the event to multiple relays
        const signedEvent = await this.signEvent(newFollowEvent)
        await this.publishContactListToMultipleRelays(signedEvent)

        // Update local follow list
        this.followList.push(provider.pubkey)

        this.$q.notify({
          type: 'positive',
          message: `Now following ${provider.name}`
        })
      } catch (error) {
        console.error('Failed to follow provider:', error)
        this.$q.notify({
          type: 'negative',
          message: 'Failed to follow provider'
        })
      } finally {
        this.followingStates[provider.pubkey] = false
      }
    },

    // Unfollow a service provider
    async unfollowProvider(provider) {
      if (this.followingStates[provider.pubkey]) return // Already processing

      this.followingStates[provider.pubkey] = true

      try {
        // Fetch current follow list from multiple relays
        const followEvent = await this.fetchContactListsFromMultipleRelays()
        let existingTags = []

        if (followEvent) {
          existingTags = followEvent.tags.filter(tag => tag[0] === 'p')
        }

        // Check if not following
        if (!existingTags.some(tag => tag[1] === provider.pubkey)) {
          this.$q.notify({
            type: 'info',
            message: 'Not following this provider'
          })
          // Remove from local follow list if it exists
          this.followList = this.followList.filter(
            pubkey => pubkey !== provider.pubkey
          )
          return
        }

        // Remove provider from follow list
        const newTags = existingTags.filter(tag => tag[1] !== provider.pubkey)

        // Create updated follow list event
        const newFollowEvent = {
          kind: 3,
          content: followEvent?.content || '',
          tags: newTags,
          created_at: Math.floor(Date.now() / 1000),
          pubkey: this.userPubkey
        }

        // Sign and publish the event to multiple relays
        const signedEvent = await this.signEvent(newFollowEvent)
        await this.publishContactListToMultipleRelays(signedEvent)

        // Update local follow list
        this.followList = this.followList.filter(
          pubkey => pubkey !== provider.pubkey
        )

        this.$q.notify({
          type: 'positive',
          message: `Unfollowed ${provider.name}`
        })
      } catch (error) {
        console.error('Failed to unfollow provider:', error)
        this.$q.notify({
          type: 'negative',
          message: 'Failed to unfollow provider'
        })
      } finally {
        this.followingStates[provider.pubkey] = false
      }
    },

    // Refresh devices
    async refreshDevices() {
      await this.fetchFollowList()
      await this.discoverIoTDevices()
    },

    // Handle page becoming visible (mobile browser resumed)
    handlePageVisible() {
      if (!this.isAuthenticated || !this.pool) return

      // Check if global subscription is still active
      if (!this.globalDVMSubscription) {
        this.setupGlobalDVMSubscription()
        return
      }

      // Test connection health by checking if pool can communicate
      this.checkConnectionHealth()
    },

    // Check if WebSocket connections are still healthy
    checkConnectionHealth() {
      if (!this.pool || !this.isAuthenticated) return

      // Close and recreate the global subscription to ensure fresh connections
      if (this.globalDVMSubscription) {
        this.globalDVMSubscription.close()
        this.globalDVMSubscription = null
      }

      // Re-establish subscription with fresh connections
      this.setupGlobalDVMSubscription()
    }
  },

  async created() {
    // Setup page visibility event listener for mobile browser handling
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.isAuthenticated) {
        this.handlePageVisible()
      }
    })

    // Attempt auto-login
    await this.autoLogin()
  }
})
