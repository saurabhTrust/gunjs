const express = require('express');
const Gun = require('gun');
const path = require('path');
const webpush = require('web-push');
const processedMessages = new Set();

const app = express();
const PORT = process.env.PORT || 3005;

// Serve frontend files
app.use(express.static(path.join(__dirname, '../frontend')));


const vapidKeys = webpush.generateVAPIDKeys();

webpush.setVapidDetails(
  'mailto:saurabhk@trustgrid.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// Optionally, you can add a route to check if the server is running
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});


// Create HTTP server
const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

app.get('/vapidPublicKey', (req, res) => {
  res.json({ key: vapidKeys.publicKey });
});

// Function to send push notification
async function sendPushNotification(userAlias, notificationData) {
  console.log('Finding devices for user:', userAlias);
  
  gun.get('users').get(userAlias).get('devices').map().once(async (device) => {
    console.log('Found device:', device);
    
    if (!device?.subscription) {
      console.log('No subscription for device');
      return;
    }

    try {
      const subscription = JSON.parse(device.subscription);
      console.log('Sending push to subscription:', subscription);
      
      await webpush.sendNotification(subscription, JSON.stringify(notificationData));
      console.log('Push notification sent successfully');
    } catch (error) {
      console.error('Push failed:', error);
      if (error.statusCode === 410) {
        console.log('Removing invalid subscription');
        gun.get('users').get(userAlias).get('devices').get(device.deviceInfo.deviceId).put(null);
      }
    }
  });
}


// Initialize Gun
const gun = Gun({
  web: server,
  file: 'data' // This will store the data in a directory named 'data'
});

// Attach Gun to the '/gun' endpoint
app.use('/gun', (req, res) => {
  gun.serve(req, res);
});

gun.get('chats').map().once((chatNode, chatId) => {
  gun.get('chats').get(chatId).map().once(async (message, messageId) => {
    if (!messageId || processedMessages.has(messageId)) return;
    processedMessages.add(messageId);

    console.log('Processing message:', { messageId, message });

    if (!message || !message.sender || !message.timestamp || message.notified) return;
    if (Date.now() - message.timestamp > 5000) return;

    const [user1, user2] = chatId.split('_');
    const recipient = message.sender === user1 ? user2 : user1;
    console.log('Sending notification to:', recipient);

    // Get all devices for the recipient
    gun.get('users').get(recipient).get('devices').map().once((deviceData, deviceId) => {
      // Skip GUN metadata
      if (deviceId === '_') return;
      
      console.log('Found device:', deviceId);
      
      // Get the actual device data
      gun.get('users').get(recipient).get('devices').get(deviceId).once((device) => {
        console.log('Device data:', device);

        if (device?.subscription) {
          try {
            const subscription = JSON.parse(device.subscription);
            console.log('Found subscription:', subscription);

            webpush.sendNotification(subscription, JSON.stringify({
              type: 'chat',
              title: `Message from ${message.sender}`,
              body: message.type === 'file' ? 'Sent a file' : message.content,
              data: { type: 'chat', from: message.sender }
            })).then(() => {
              console.log('Push notification sent successfully');
              gun.get('chats').get(chatId).get(messageId).get('notified').put(true);
            }).catch(error => {
              console.error('Push failed:', error);
              if (error.statusCode === 410) {
                gun.get('users').get(recipient).get('devices').get(deviceId).put(null);
              }
            });
          } catch (error) {
            console.error('Error processing subscription:', error);
          }
        } else {
          console.log('No subscription found for device:', deviceId);
        }
      });
    });
  });
});

setInterval(() => {
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  processedMessages.clear();
}, 60 * 60 * 1000); // Clear every hour

// const express = require('express');
// const Gun = require('gun');
// const path = require('path');
// const https = require('https');
// const fs = require('fs');

// const app = express();
// const PORT = process.env.PORT || 8443;

// // Serve frontend files
// app.use(express.static(path.join(__dirname, '../frontend')));

// // Health check route
// app.get('/health', (req, res) => {
//   res.status(200).json({ status: 'OK' });
// });

// // Read SSL certificate and key
// const options = {
//   key: fs.readFileSync(path.join(__dirname, 'key.pem')),
//   cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
// };

// // Create HTTPS server
// const server = https.createServer(options, app);

// server.listen(PORT, () => {
//   console.log(`Server running on https://localhost:${PORT}`);
// });

// // Initialize Gun
// const gun = Gun({
//   web: server,
//   file: 'data' // This will store the data in a directory named 'data'
// });

// // Attach Gun to the '/gun' endpoint
// app.use('/gun', (req, res) => {
//   gun.serve(req, res);
// });