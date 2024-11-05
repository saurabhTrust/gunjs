// server.js

const fs = require('fs');
const path = require('path');
const express = require('express');
const Gun = require('gun');
const webpush = require('web-push');
const { LRUCache } = require('lru-cache'); // Fixed import

// Use LRU Cache with corrected constructor
const processedEvents = new LRUCache({
  max: 5000, // Maximum number of items
  ttl: 1000 * 60 * 5 // Items expire after 5 minutes (ttl instead of maxAge)
});

const app = express();
const PORT = process.env.PORT || 3005;

// Serve frontend files
app.use(express.static(path.join(__dirname, '../frontend')));

const vapidKeys = getVapidKeys();

webpush.setVapidDetails(
  'mailto:your-email@example.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

function getVapidKeys() {
  const vapidPath = path.join(__dirname, 'vapid-keys.json');
  try {
    if (fs.existsSync(vapidPath)) {
      return JSON.parse(fs.readFileSync(vapidPath));
    }
    const keys = webpush.generateVAPIDKeys();
    fs.writeFileSync(vapidPath, JSON.stringify(keys));
    return keys;
  } catch (error) {
    console.error('Error handling VAPID keys:', error);
    process.exit(1);
  }
}

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

app.get('/vapidPublicKey', (req, res) => {
  res.json({ key: vapidKeys.publicKey });
});

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

const gun = Gun({
  web: server,
  file: 'data'
});

// Debounce helper for push notifications
const pushDebounceMap = new Map();
function debouncedPushNotification(userAlias, data, delay = 1000) {
  const key = `${userAlias}-${data.type}`;
  if (pushDebounceMap.has(key)) {
    clearTimeout(pushDebounceMap.get(key));
  }
  
  const timeoutId = setTimeout(async () => {
    try {
      await sendPushNotification(userAlias, data);
    } catch (error) {
      console.error('Push notification failed:', error);
    }
    pushDebounceMap.delete(key);
  }, delay);
  
  pushDebounceMap.set(key, timeoutId);
}

// Call handling with proper state management
gun.get('calls').map().once((callNode, callId) => {
  if (processedEvents.has(`call-${callId}`)) return;
  processedEvents.set(`call-${callId}`, true);

  gun.get('calls').get(callId).on(async (callData) => {
    if (!callData || !callData.to) return;

    try {
      // Only handle new call offers
      if (callData.type === 'offer' && callData.status === 'connecting') {
        const notificationData = {
          type: 'call',
          title: `Incoming ${callData.isVideo ? 'Video' : 'Voice'} Call`,
          body: `${callData.from} is calling...`,
          data: {
            type: 'call',
            from: callData.from,
            callId: callId,
            isVideo: callData.isVideo,
            offerSdp: callData.offerSdp,
            offerType: callData.offerType,
            timestamp: Date.now()
          }
        };

        // Wait briefly for WebRTC setup before sending push
        await new Promise(resolve => setTimeout(resolve, 1000));
        await sendPushNotification(callData.to, notificationData);
        
        // Update call status
        gun.get('calls').get(callId).get('status').put('notified');
      }
    } catch (error) {
      console.error('Error processing call:', error);
      gun.get('calls').get(callId).get('status').put('error');
    }
  });
});

// Chat message handling
gun.get('chats').map().once((chatNode, chatId) => {
  gun.get('chats').get(chatId).map().once(async (message, messageId) => {
    if (!messageId || processedEvents.has(`msg-${messageId}`)) return;
    processedEvents.set(`msg-${messageId}`, true);

    if (!message || !message.sender || message.notified) return;

    const [user1, user2] = chatId.split('_');
    const recipient = message.sender === user1 ? user2 : user1;

    const notificationData = {
      type: 'chat',
      title: `Message from ${message.sender}`,
      body: message.type === 'file' ? 'Sent a file' : message.content,
      data: { type: 'chat', from: message.sender }
    };

    debouncedPushNotification(recipient, notificationData);
  });
});

// Group chat handling
gun.get('groupChats').map().once((chatNode, groupId) => {
  gun.get('groupChats').get(groupId).map().once(async (message, messageId) => {
    if (!messageId || processedEvents.has(`group-msg-${messageId}`)) return;
    processedEvents.set(`group-msg-${messageId}`, true);

    if (!message || !message.sender || message.notified) return;

    gun.get('groups').get(groupId).once((groupData) => {
      if (!groupData || !groupData.members) return;

      Object.keys(groupData.members).forEach((memberAlias) => {
        if (memberAlias === message.sender || memberAlias === '_') return;

        const notificationData = {
          type: 'group',
          title: groupData.name,
          body: `${message.sender}: ${message.type === 'file' ? 'Sent a file' : message.content}`,
          data: {
            type: 'group',
            groupId: groupId,
            from: message.sender
          }
        };

        debouncedPushNotification(memberAlias, notificationData);
      });
    });
  });
});

async function sendPushNotification(userAlias, notificationData) {
  console.log('Sending notification to:', userAlias);
  
  return new Promise((resolve, reject) => {
    gun.get('users').get(userAlias).get('devices').map().once(async (device) => {
      if (!device?.subscription) {
        console.log('No subscription for device:', device);
        return;
      }

      try {
        const subscription = JSON.parse(device.subscription);
        await webpush.sendNotification(subscription, JSON.stringify(notificationData));
        resolve();
      } catch (error) {
        if (error.statusCode === 410) {
          gun.get('users').get(userAlias).get('devices').get(device.deviceInfo?.deviceId).put(null);
        }
        reject(error);
      }
    });
  });
}

// Cleanup old processed events periodically
setInterval(() => {
  processedEvents.purgeStale(); // Changed from prune() to purgeStale()
}, 60 * 1000); // Every minute

app.use('/gun', (req, res) => {
  gun.serve(req, res);
});