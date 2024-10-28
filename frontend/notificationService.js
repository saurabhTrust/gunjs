// notificationService.js

class NotificationService {
    constructor(gun, user) {
      this.gun = gun;
      this.user = user;
      this.debug = true;
      this.serviceWorkerRegistration = null;
      this.isInitialized = false;
      this.processedMessages = new Set(); // Track processed messages
      this.initialize();
    }
  
    log(...args) {
      if (this.debug) {
        console.log('[NotificationService]', ...args);
      }
    }
  
    async initialize() {
      try {
        if (!('Notification' in window)) {
          console.error('This browser does not support notifications');
          return;
        }
  
        // Request permission if needed
        if (Notification.permission === 'default') {
          const permission = await Notification.requestPermission();
          this.log('Notification permission:', permission);
        }
  
        // Register service worker
        this.serviceWorkerRegistration = await navigator.serviceWorker.register('/notification-worker.js');
        this.log('Service Worker registered');
  
        // Wait for activation
        await this.waitForServiceWorkerActivation();
  
        // Setup listeners
        this.setupMessageListeners();
  
        this.isInitialized = true;
        this.log('Notification service initialized');
  
        // Start monitoring window visibility
        this.setupVisibilityListener();
      } catch (error) {
        console.error('Failed to initialize notification service:', error);
      }
    }
  
    setupVisibilityListener() {
      document.addEventListener('visibilitychange', () => {
        this.log('Visibility changed:', document.visibilityState);
      });
    }
  
    setupMessageListeners() {
      if (!this.user?.is?.alias) {
        this.log('User not initialized');
        return;
      }
  
      this.log('Setting up message listeners for user:', this.user.is.alias);
  
      // Listen for direct messages
    //   this.gun.get('chats').map().on((chat, chatId) => {
    //     this.log('Raw chat message received:', { chat, chatId });
    //     this.handleIncomingMessage(chat, chatId);
    //   });
  
      // Listen for contact requests
      this.gun.get('users')
        .get(this.user.is.alias)
        .get('contactRequests')
        .map()
        .on((request, requestId) => {
          this.log('Contact request received:', { request, requestId });
          this.handleContactRequest(request, requestId);
        });
  
      // Listen for calls
      this.gun.get('calls')
        .map()
        .on((callData, callId) => {
          this.log('Call data received:', { callData, callId });
          this.handleCallNotification(callData, callId);
        });
  
      this.log('Message listeners setup complete');
    }
  
    async handleIncomingMessage(chat, chatId) {
      // Generate a unique ID for this message
      const messageId = `${chatId}-${chat?.timestamp || Date.now()}`;
  
      // Check if we've already processed this message
      if (this.processedMessages.has(messageId)) {
        return;
      }
  
      this.log('Processing message:', {
        chat,
        chatId,
        isHidden: document.hidden,
        currentUser: this.user.is.alias
      });
  
      if (!chat || !chat.content || !chat.sender) {
        this.log('Invalid message data');
        return;
      }
  
    //   const isForCurrentUser = chat.to === this.user.is.alias;
    //   const isFromOthers = chat.from !== this.user.is.alias;
    //   const isRecent = !chat.timestamp || (Date.now() - Number(chat.timestamp)) < 10000; // Increased time window
      const isUnnotified = !chat.notified;
  
    //   this.log('Message checks:', {
    //     isForCurrentUser,
    //     isFromOthers,
    //     isRecent,
    //     isUnnotified,
    //     timestamp: chat.timestamp
    //   });
  
      if (isUnnotified) {
        try {
          await this.showNotification({
            title: `Message from ${chat.from}`,
            body: chat.content,
            tag: `chat-${chatId}`,
            data: {
              type: 'chat',
              chatId,
              from: chat.from,
              content: chat.content
            }
          });
  
          // Mark as notified
          this.gun.get('chats')
            .get(chatId)
            .get('notified')
            .put(true);
  
          // Add to processed messages
          this.processedMessages.add(messageId);
  
          // Clean up old processed messages
          if (this.processedMessages.size > 1000) {
            const oldestMessages = Array.from(this.processedMessages).slice(0, 500);
            oldestMessages.forEach(id => this.processedMessages.delete(id));
          }
  
        } catch (error) {
          console.error('Error showing chat notification:', error);
        }
      }
    }
  
    async handleContactRequest(request, requestId) {
      this.log('Processing contact request:', { request, requestId });
  
      if (!request || !request.from || request.handled || !document.hidden) {
        return;
      }
  
      try {
        await this.showNotification({
          title: 'New Contact Request',
          body: `${request.from} wants to connect with you`,
          tag: `contact-${requestId}`,
          data: {
            type: 'contact',
            from: request.from,
            requestId
          }
        });
  
        // Mark request as handled
        this.gun.get('users')
          .get(this.user.is.alias)
          .get('contactRequests')
          .get(requestId)
          .get('handled')
          .put(true);
      } catch (error) {
        console.error('Error showing contact request notification:', error);
      }
    }
  
    async handleCallNotification(callData, callId) {
      this.log('Processing call notification:', { callData, callId });
  
      if (!callData || 
          callData.to !== this.user.is.alias || 
          callData.type !== 'offer' || 
          callData.notified) {
        return;
      }
  
      try {
        const callType = callData.isVideo ? 'Video' : 'Voice';
        await this.showNotification({
          title: `Incoming ${callType} Call`,
          body: `${callData.from} is calling you`,
          tag: `call-${callId}`,
          requireInteraction: true,
          data: {
            type: 'call',
            callId,
            from: callData.from,
            isVideo: callData.isVideo
          }
        });
  
        // Mark call as notified
        this.gun.get('calls')
          .get(callId)
          .get('notified')
          .put(true);
      } catch (error) {
        console.error('Error showing call notification:', error);
      }
    }
  
    async showNotification(options) {
      if (!this.isInitialized || !navigator.serviceWorker.controller) {
        this.log('Service not ready for notifications');
        return;
      }
  
      this.log('Showing notification:', options);
  
      try {
        navigator.serviceWorker.controller.postMessage({
          type: 'showNotification',
          ...options,
          timestamp: Date.now(),
        //   icon: '/app-icon.png',
        //   badge: '/notification-badge.png',
          vibrate: [200, 100, 200],
          requireInteraction: options.requireInteraction || false,
          actions: [
            { action: 'open', title: 'Open' },
            { action: 'dismiss', title: 'Dismiss' }
          ]
        });
      } catch (error) {
        console.error('Error sending notification to service worker:', error);
      }
    }

    async waitForServiceWorkerActivation() {
        if (!this.serviceWorkerRegistration) return;
    
        if (this.serviceWorkerRegistration.active) {
          this.log('Service Worker already active');
          return;
        }
    
        return new Promise((resolve) => {
          this.serviceWorkerRegistration.addEventListener('activate', () => {
            this.log('Service Worker activated');
            resolve();
          });
        });
    }
  }