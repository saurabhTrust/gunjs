const gun = Gun(['https://172.188.24.76:8443/gun']);

// User state
let user;
let currentChat = null;

// DOM Elements
const authDiv = document.getElementById('auth');
const chatDiv = document.getElementById('chat');
const loginBtn = document.getElementById('login');
const registerBtn = document.getElementById('register');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessage');
const contactsList = document.getElementById('contactsList');
const newContactInput = document.getElementById('newContactInput');
const addContactBtn = document.getElementById('addContact');
const currentChatHeader = document.getElementById('currentChatHeader');
const messageControls = document.getElementById('messageControls');


function register() {
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  
  if (!username || !password) {
    alert('Please enter both username and password');
    return;
  }
  
  user = gun.user();
  user.create(username, password, (ack) => {
    if (ack.err) {
      alert(ack.err);
    } else {
      // Store the user's public data
      gun.get('users').get(username).put({ username: username });
      alert('Registration successful. You can now log in.');
    }
  });
}

function login() {
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  
  user = gun.user();
  user.auth(username, password, (ack) => {
    if (ack.err) {
      alert(ack.err);
    } else {
      console.log("User authenticated:", user.is.alias);
      // Store/update the user's public data
      gun.get('users').get(username).put({ username: username });
      initializeApp();
    }
  });
}

function loadContacts() {
  console.log("Loading contacts for", user.is.alias);
  contactsList.innerHTML = '';
  user.get('contacts').map().on((contactData, contactId) => {
    console.log("Contact data:", contactId, contactData);
    if (contactData && contactData.alias && !contactsList.querySelector(`[data-id="${contactId}"]`)) {
      const contactElement = document.createElement('div');
      contactElement.textContent = contactData.alias;
      contactElement.dataset.id = contactId;
      contactElement.classList.add('contact');
      contactElement.addEventListener('click', () => startChat(contactData.alias));
      contactsList.appendChild(contactElement);
    }
  });
}

function startChat(contactAlias) {
  currentChat = contactAlias;
  currentChatHeader.textContent = `Chat with ${contactAlias}`;
  messagesDiv.innerHTML = '';
  messageControls.classList.remove('hidden');
  loadMessages(contactAlias);
}

function loadMessages(contactAlias) {
  const chatId = getChatId(user.is.alias, contactAlias);
  gun.get(`chats`).get(chatId).map().on((message, id) => {
    if (message && !messagesDiv.querySelector(`[data-id="${id}"]`)) {
      const messageElement = document.createElement('div');
      messageElement.textContent = `${message.sender}: ${message.content}`;
      messageElement.dataset.id = id;
      messageElement.classList.add('message', message.sender === user.is.alias ? 'sent' : 'received');
      messagesDiv.appendChild(messageElement);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
  });
}

function sendMessage() {
  const content = messageInput.value.trim();
  if (content && currentChat) {
    const chatId = getChatId(user.is.alias, currentChat);
    gun.get(`chats`).get(chatId).set({
      sender: user.is.alias,
      content: content,
      timestamp: Date.now()
    });
    messageInput.value = '';
  }
}

function addContact() {
  const newContact = newContactInput.value.trim();
  if (newContact && newContact !== user.is.alias) {
    gun.get('users').get(newContact).once((userData) => {
      console.log("Looking up user:", newContact, "Result:", userData);
      if (userData && userData.username) {
        // User exists, send a contact request
        gun.get('users').get(newContact).get('contactRequests').set({
          from: user.is.alias,
          timestamp: Date.now()
        }, (ack) => {
          console.log("Contact request sent:", ack);
        });
        newContactInput.value = '';
        alert(`Contact request sent to ${newContact}`);
      } else {
        alert(`User ${newContact} does not exist.`);
      }
    });
  }
}

function listenForContactRequests() {
  console.log("I am running");
  user.get('contactRequests').map().on((request, requestId) => {
    console.log(request)
    if (request && request.from && !request.handled) {
      const confirmed = confirm(`${request.from} wants to add you as a contact. Accept?`);
      if (confirmed) {
        // Add the contact for both users
        user.get('contacts').get(request.from).put({ alias: request.from });
        gun.get(`users`).get(request.from).get('contacts').get(user.is.alias).put({ alias: user.is.alias });
        
        // Remove the contact request
        user.get('contactRequests').get(requestId).put(null);
        
        // Refresh the contacts list
        loadContacts();
      } else {
        // If rejected, just mark as handled
        user.get('contactRequests').get(requestId).put({...request, handled: true});
      }
    }
  });
}

function getChatId(user1, user2) {
  return [user1, user2].sort().join('_');
}

// Event Listeners
registerBtn.addEventListener('click', register);
loginBtn.addEventListener('click', login);
sendMessageBtn.addEventListener('click', sendMessage);
addContactBtn.addEventListener('click', addContact);

// Initialize when the page loads
window.addEventListener('load', () => {
  if (user && user.is) {
    initializeApp();
  }
});

function initializeApp() {
  console.log("Initializing app");
  if (user && user.is) {
    authDiv.classList.add('hidden');
    chatDiv.classList.remove('hidden');
    chatDiv.style.display = "flex";
    loadContacts();
    setupContactRequestListener();
    setupContactAcceptanceListener(); 
  }
}

function setupContactRequestListener() {
  console.log("Setting up contact request listener for", user.is.alias);
  gun.get('users').get(user.is.alias).get('contactRequests').map().on((request, requestId) => {
    console.log("Received contact request:", request, requestId);
    if (request && request.from && !request.handled) {
      handleContactRequest(request, requestId);
    }
  });
}

// function handleContactRequest(request, requestId) {
//   console.log("Handling contact request:", request, requestId);
//   const confirmed = confirm(`${request.from} wants to add you as a contact. Accept?`);
//   if (confirmed) {
//     // Add the contact for the current user
//     user.get('contacts').get(request.from).put({ alias: request.from }, (ack) => {
//       console.log("Added contact for current user:", ack);
//     });

//     // Add the current user as a contact for the requester
//     gun.get('users').get(request.from).get('contacts').get(user.is.alias).put({ alias: user.is.alias }, (ack) => {
//       console.log("Added current user as contact for requester:", ack);
//     });
    
//     // Remove the contact request
//     gun.get('users').get(user.is.alias).get('contactRequests').get(requestId).put(null, (ack) => {
//       console.log("Removed contact request:", ack);
//     });
    
//     // Refresh the contacts list
//     loadContacts();

//     // Notify the requester that the contact request was accepted
//     gun.get('users').get(request.from).get('notifications').set({
//       type: 'contact_accepted',
//       from: user.is.alias,
//       timestamp: Date.now()
//     });

//     alert(`You are now connected with ${request.from}`);
//   } else {
//     // If rejected, just mark as handled
//     gun.get('users').get(user.is.alias).get('contactRequests').get(requestId).put({...request, handled: true}, (ack) => {
//       console.log("Marked contact request as handled:", ack);
//     });
//   }
// }

function handleContactRequest(request, requestId) {
  console.log("Handling contact request:", request, requestId);
  const confirmed = confirm(`${request.from} wants to add you as a contact. Accept?`);
  if (confirmed) {
    // Add the contact for the current user
    user.get('contacts').get(request.from).put({ alias: request.from }, (ack) => {
      console.log("Added contact for current user:", ack);
    });

    // Add the current user as a contact for the requester
    gun.get('users').get(request.from).get('contacts').get(user.is.alias).put({ alias: user.is.alias }, (ack) => {
      console.log("Added current user as contact for requester:", ack);
    });
    
    // Remove the contact request
    gun.get('users').get(user.is.alias).get('contactRequests').get(requestId).put(null, (ack) => {
      console.log("Removed contact request:", ack);
    });
    
    // Refresh the contacts list
    loadContacts();

    // Send acknowledgment to the requester
    gun.get('users').get(request.from).get('contactAcceptances').set({
      from: user.is.alias,
      timestamp: Date.now()
    });

    alert(`You are now connected with ${request.from}`);
  } else {
    // If rejected, just mark as handled
    gun.get('users').get(user.is.alias).get('contactRequests').get(requestId).put({...request, handled: true}, (ack) => {
      console.log("Marked contact request as handled:", ack);
    });
  }
}


function setupContactAcceptanceListener() {
  console.log("Setting up contact acceptance listener for", user.is.alias);
  gun.get('users').get(user.is.alias).get('contactAcceptances').map().on((acceptance, acceptanceId) => {
    console.log("Received contact acceptance:", acceptance, acceptanceId);
    if (acceptance && acceptance.from) {
      // Add the contact to the sender's list
      user.get('contacts').get(acceptance.from).put({ alias: acceptance.from }, (ack) => {
        console.log("Added accepted contact for sender:", ack);
      });
      
      // Remove the acceptance notification
      gun.get('users').get(user.is.alias).get('contactAcceptances').get(acceptanceId).put(null);
      
      // Refresh the contacts list
      loadContacts();
      
      alert(`${acceptance.from} has accepted your contact request!`);
    }
  });
}