self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Notification schemas for different types
const notificationSchemas = {
  chat: {
    title: (data) => `Message from ${data.sender}`,
    body: (data) => data.type === 'file' ? 'Sent a file' : data.content,
    data: (data) => ({ type: 'chat', from: data.sender })
  },
  group: {
    title: (data) => `${data.groupName}`,
    body: (data) => `${data.sender}: ${data.type === 'file' ? 'Sent a file' : data.content}`,
    data: (data) => ({ type: 'group', groupId: data.groupId, from: data.sender })
  },
  call: {
    title: (data) => `${data.title}`,
    body: (data) => `${data.body}`,
    data: (data) => ({
      type: 'call',
      from: data.from,
      callId: data.callId,
      isVideo: data.isVideo,
      offerSdp: data.offerSdp,
      offerType: data.offerType
    })
  }
};

const notificationOptions = {
  chat: {
    icon: '/app-icon.png',
    badge: '/badge-icon.png',
    sound: '/notification.wav',
    requireInteraction: false,
    renotify: true,
    vibrate: [200, 100, 200],
    actions: [
      {
        action: 'reply',
        title: 'Reply'
      }
    ]
  },
  group: {
    icon: '/app-icon.png',
    badge: '/badge-icon.png',
    sound: '/notification.wav',
    requireInteraction: false,
    renotify: true,
    vibrate: [200, 100, 200],
    actions: [
      {
        action: 'view',
        title: 'View Stream'
      }
    ]
  },
  call: {
    icon: '/app-icon.png',
    badge: '/badge-icon.png',
    sound: '/notification.wav',
    requireInteraction: true,
    renotify: true,
    vibrate: [200, 100, 200, 100, 200],
    actions: [
      {
        action: 'accept',
        title: 'Accept'
      },
      {
        action: 'decline',
        title: 'Decline'
      }
    ]
  }
};

self.addEventListener('push', (event) => {
  console.log('Push event received:', event);
  try {
    const data = event.data.json();
    console.log('Push data:', data);

    const schema = notificationSchemas[data.type];
    if (!schema) {
      console.error('Unknown notification type:', data.type);
      return;
    }

    const options = {
      ...notificationOptions[data.type],
      body: schema.body(data),
      data: schema.data(data),
      tag: getNotificationTag(data),
      silent: false
    };

    // Add distinct vibration patterns for different notification types
    if (data.type === 'call') {
      options.vibrate = [200, 100, 200, 100, 200, 100, 200];
    } else if (data.type === 'group') {
      options.vibrate = [100, 50, 100];
    } else {
      options.vibrate = [200];
    }

    console.log('Showing notification with options:', options);

    event.waitUntil(
      self.registration.showNotification(schema.title(data), options)
        .then(() => console.log('Notification shown successfully'))
        .catch(err => console.error('Error showing notification:', err))
    );
  } catch (error) {
    console.error('Error in push event:', error);
  }
});

function getNotificationTag(data) {
  switch (data.type) {
    case 'chat':
      return `chat-${data.sender}`;
    case 'group':
      return `group-${data.groupId}`;
    case 'call':
      return `call-${data.callId}`;
    default:
      return data.type;
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data;
  const action = event.action;

  let handlePromise;

  switch (data.type) {
    case 'chat':
      handlePromise = handleChatNotificationClick(data, action);
      break;
    case 'group':
      handlePromise = handleGroupNotificationClick(data, action);
      break;
    case 'call':
      handlePromise = handleCallNotificationClick(data, action);
      break;
    default:
      handlePromise = Promise.resolve();
  }

  event.waitUntil(handlePromise);
});

async function handleChatNotificationClick(data, action) {
  if (action === 'reply') {
    return openOrFocusWindow();
  }
  return openOrFocusWindow();
}

async function handleGroupNotificationClick(data, action) {
  return openOrFocusWindow(`/group/${data.groupId}`);
}

async function handleCallNotificationClick(data, action) {
  const url = `/chat/${data.from}`;
  const urlWithParams = new URL(url, self.location.origin);
  
  if (action === 'accept') {
    urlWithParams.searchParams.set('action', 'acceptCall');
    urlWithParams.searchParams.set('callId', data.callId);
    urlWithParams.searchParams.set('isVideo', data.isVideo);
    urlWithParams.searchParams.set('offerSdp', encodeURIComponent(data.offerSdp));
    urlWithParams.searchParams.set('offerType', data.offerType);
  } else if (action === 'decline') {
    urlWithParams.searchParams.set('action', 'declineCall');
    urlWithParams.searchParams.set('callId', data.callId);
  }

  return openOrFocusWindow();
}

async function openOrFocusWindow(urlToOpen) {
  const clientList = await clients.matchAll({
    type: 'window',
    includeUncontrolled: true
  });

  for (const client of clientList) {
    const url = new URL(client.url);
    const targetUrl = new URL('', self.location.origin);

    if (url.pathname === targetUrl.pathname) {
      await client.focus();
      if (targetUrl.search) {
        return client.navigate(targetUrl.toString());
      }
      return;
    }
  }

  return clients.openWindow(urlToOpen);
}