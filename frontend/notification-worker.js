self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  console.log('Push event received:', event);
  try {
    const data = event.data.json();
    console.log('Push data:', data);
    
    const options = {
      body: data.body,
      icon: '/app-icon.png',
      badge: '/badge-icon.png',
      sound: '/notification.wav',
      data: data.data,
      tag: data.type === 'chat' ? `chat-${data.data.from}` : data.type,
      renotify: true,
      requireInteraction: true
    };

    console.log('Showing notification with options:', options);

    event.waitUntil(
      self.registration.showNotification(data.title, options)
        .then(() => console.log('Notification shown successfully'))
        .catch(err => console.error('Error showing notification:', err))
    );
  } catch (error) {
    console.error('Error in push event:', error);
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data;
  let urlToOpen = '/';

  // Determine which URL to open based on notification type
  switch (data.type) {
    case 'chat':
      urlToOpen = `/chat/${data.from}`;
      break;
    case 'group':
      urlToOpen = `/group/${data.groupId}`;
      break;
    case 'call':
      urlToOpen = `/chat/${data.from}`;
      break;
    case 'contact':
      urlToOpen = '/contacts';
      break;
  }

  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then((clientList) => {
      // If a window is already open, focus it
      for (let client of clientList) {
        if (client.url.includes(urlToOpen)) {
          return client.focus();
        }
      }
      // If no window is open, open a new one
      return clients.openWindow(urlToOpen);
    })
  );
});