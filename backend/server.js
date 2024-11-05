const fs = require('fs');
const path = require('path');

const express = require('express');
const Gun = require('gun');
const webpush = require('web-push');

const processedMessages = new Set();
const processedCalls = new Set();

const app = express();
const PORT = process.env.PORT || 3005;

// Serve frontend files
app.use(express.static(path.join(__dirname, '../frontend')));


const vapidKeys = getVapidKeys();

function getVapidKeys() {
  const vapidPath = path.join(__dirname, 'vapid-keys.json');
  
  try {
      if (fs.existsSync(vapidPath)) {
          const keys = JSON.parse(fs.readFileSync(vapidPath));
          console.log('Loaded existing VAPID keys');
          return keys;
      }
      const keys = webpush.generateVAPIDKeys();
      
      fs.writeFileSync(vapidPath, JSON.stringify(keys));
      console.log('Generated and saved new VAPID keys');
      
      return keys;
  } catch (error) {
      console.error('Error handling VAPID keys:', error);
      process.exit(1);
  }
}

webpush.setVapidDetails(
  'mailto:saurabhk@trustgrid.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});


const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

app.get('/vapidPublicKey', (req, res) => {
  res.json({ key: vapidKeys.publicKey });
});


const gun = Gun({
  web: server,
  file: 'data'
});

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

// gun.get('calls').map().once((callNode, callId) => {
//   console.log('Call node detected:', { callId, callNode });
  
//   gun.get('calls').get(callId).once(async (callData) => {
//     try {
//       console.log('Initial call data:', { callId, callData });
      
//       if (!callData) {
//         console.log('No call data found for:', callId);
//         return;
//       }

//       // Skip if already processed
//       if (processedCalls.has(callId)) {
//         console.log('Call already processed:', callId);
//         return;
//       }
      
//       processedCalls.add(callId);

//       // Validate required fields
//       if (!callData.type || !callData.from || !callData.to) {
//         console.log('Invalid call data structure:', callData);
//         return;
//       }

//       // Only handle initial call offers
//       if (callData.type === 'offer') {
//         console.log('Processing call offer:', callData);
        
//         const notificationData = {
//           type: 'call',
//           title: `Incoming ${callData.isVideo ? 'Video' : 'Voice'} Call`,
//           body: `${callData.from} is calling...`,
//           data: {
//             type: 'call',
//             from: callData.from,
//             callId: callId,
//             isVideo: callData.isVideo,
//             offerSdp: callData.offerSdp,
//             offerType: callData.offerType,
//             timestamp: Date.now()
//           }
//         };

//         await sendPushNotification(callData.to, notificationData);
//         console.log('Call notification sent successfully');
        
//         // Mark the call as notified
//         gun.get('calls').get(callId).get('notified').put(true);
//       }
//     } catch (error) {
//       console.error('Error processing call:', error);
//     }
//   });
// });

gun.get('users').map().once((userData, userAlias) => {
  gun.get('users').get(userAlias).get('contactRequests').map().once(async (request, requestId) => {
    if (!request || request.notified || !request.from) return;

    console.log('Processing contact request notification:', { userAlias, request });

    // Get all devices for the recipient
    gun.get('users').get(userAlias).get('devices').map().once((deviceData, deviceId) => {
      if (deviceId === '_') return;
      
      gun.get('users').get(userAlias).get('devices').get(deviceId).once((device) => {
        if (device?.subscription) {
          try {
            const subscription = JSON.parse(device.subscription);
            webpush.sendNotification(subscription, JSON.stringify({
              type: 'contactRequest',
              title: 'New Contact Request',
              body: `${request.from} wants to connect with you`,
              data: {
                type: 'contactRequest',
                from: request.from,
                requestId: requestId
              }
            })).then(() => {
              gun.get('users').get(userAlias).get('contactRequests').get(requestId).get('notified').put(true);
            }).catch(error => {
              console.error('Push failed:', error);
              if (error.statusCode === 410) {
                gun.get('users').get(userAlias).get('devices').get(deviceId).put(null);
              }
            });
          } catch (error) {
            console.error('Error processing subscription:', error);
          }
        }
      });
    });
  });

  gun.get('users').get(userAlias).get('groupInvitations').map().once(async (invitation, invitationId) => {
    if (!invitation || invitation.notified || !invitation.from) return;

    console.log('Processing group invitation notification:', { userAlias, invitation });

    gun.get('users').get(userAlias).get('devices').map().once((deviceData, deviceId) => {
      if (deviceId === '_') return;
      
      gun.get('users').get(userAlias).get('devices').get(deviceId).once((device) => {
        if (device?.subscription) {
          try {
            const subscription = JSON.parse(device.subscription);
            webpush.sendNotification(subscription, JSON.stringify({
              type: 'groupInvitation',
              title: 'New Stream Invitation',
              body: `${invitation.from} invited you to join "${invitation.groupName}"`,
              data: {
                type: 'groupInvitation',
                from: invitation.from,
                groupId: invitation.groupId,
                groupName: invitation.groupName,
                invitationId: invitationId
              }
            })).then(() => {
              gun.get('users').get(userAlias).get('groupInvitations').get(invitationId).get('notified').put(true);
            }).catch(error => {
              console.error('Push failed:', error);
              if (error.statusCode === 410) {
                gun.get('users').get(userAlias).get('devices').get(deviceId).put(null);
              }
            });
          } catch (error) {
            console.error('Error processing subscription:', error);
          }
        }
      });
    });
  });
});

gun.get('groupChats').map().once((chatNode, groupId) => {
  gun.get('groupChats').get(groupId).map().once(async (message, messageId) => {
    if (!messageId || !message || !message.sender || !message.timestamp || message.notified) return;
    if (Date.now() - message.timestamp > 5000) return;

    console.log('Processing group message:', { groupId, messageId, message });

    // Get group members
    gun.get('groups').get(groupId).once((groupData) => {
      if (!groupData || !groupData.members) return;

      // Send notification to all group members except sender
      Object.keys(groupData.members).forEach((memberAlias) => {
        if (memberAlias === message.sender || memberAlias === '_') return;

        // Get member's devices
        gun.get('users').get(memberAlias).get('devices').map().once((deviceData, deviceId) => {
          if (deviceId === '_') return;

          gun.get('users').get(memberAlias).get('devices').get(deviceId).once((device) => {
            if (device?.subscription) {
              try {
                const subscription = JSON.parse(device.subscription);
                webpush.sendNotification(subscription, JSON.stringify({
                  type: 'group',
                  title: groupData.name,
                  body: message.type === 'file' ? `${message.sender} sent a file` : `${message.sender}: ${message.content}`,
                  data: {
                    type: 'group',
                    groupId: groupId,
                    groupName: groupData.name,
                    from: message.sender,
                    messageId: messageId
                  }
                })).then(() => {
                  gun.get('groupChats').get(groupId).get(messageId).get('notified').put(true);
                }).catch(error => {
                  console.error('Push failed:', error);
                  if (error.statusCode === 410) {
                    gun.get('users').get(memberAlias).get('devices').get(deviceId).put(null);
                  }
                });
              } catch (error) {
                console.error('Error processing subscription:', error);
              }
            }
          });
        });
      });
    });
  });
});

async function sendPushNotification(userAlias, notificationData, retries = 3) {
  console.log('Sending notification to:', userAlias, 'Data:', notificationData);
  
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await sendPushNotificationToUser(userAlias, notificationData);
      console.log('Notification sent successfully on attempt:', attempt);
      return;
    } catch (error) {
      lastError = error;
      console.error(`Attempt ${attempt} failed:`, error);
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  throw lastError;
}

async function sendPushNotificationToUser(userAlias, notificationData) {
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
          console.log('Removing invalid subscription for device');
          gun.get('users').get(userAlias).get('devices').get(device.deviceInfo.deviceId).put(null);
        }
        reject(error);
      }
    });
  });
}

setInterval(() => {
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  processedMessages.clear();
}, 60 * 60 * 1000);
