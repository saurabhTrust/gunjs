const gun = Gun(['https://172.188.24.76:5001/gun']);

// User state
let user;
let currentChat = null;
let currentChatType = null; // 'direct' or 'group'
let webrtcHandler;
let peerConnection = null;
let localStream;
let isCallInProgress = false;
let localICECandidates = [];
let currentCall = null;

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
const groupsList = document.getElementById('groupsList');
const newContactInput = document.getElementById('newContactInput');
const addContactBtn = document.getElementById('addContact');
const createGroupBtn = document.getElementById('createGroup');
const newGroupNameInput = document.getElementById('newGroupName');
const currentChatHeader = document.getElementById('currentChatHeader');
const messageControls = document.getElementById('messageControls');
const addToGroupBtn = document.getElementById('addToGroup');
const addToGroupInput = document.getElementById('addToGroupInput');
const startVoiceCallBtn = document.getElementById('startVoiceCall');
const endVoiceCallBtn = document.getElementById('endVoiceCall');
const callControls = document.getElementById('callControls');
const remoteAudio = document.getElementById('remoteAudio');


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

// function startChat(contactAlias) {
//   currentChat = contactAlias;
//   currentChatHeader.textContent = `Chat with ${contactAlias}`;
//   messagesDiv.innerHTML = '';
//   messageControls.classList.remove('hidden');
//   loadMessages(contactAlias);
// }

function startChat(contactAlias) {
  currentChat = contactAlias;
  currentChatType = 'direct';
  currentChatHeader.textContent = `Chat with ${contactAlias}`;
  messagesDiv.innerHTML = '';
  messageControls.classList.remove('hidden');
  callControls.classList.remove('hidden');
  addToGroupBtn.classList.add('hidden');
  addToGroupInput.classList.add('hidden');
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

// function sendMessage() {
//   const content = messageInput.value.trim();
//   if (content && currentChat) {
//     const chatId = getChatId(user.is.alias, currentChat);
//     gun.get(`chats`).get(chatId).set({
//       sender: user.is.alias,
//       content: content,
//       timestamp: Date.now()
//     });
//     messageInput.value = '';
//   }
// }

function sendMessage() {
  const content = messageInput.value.trim();
  if (content && currentChat) {
    if (currentChatType === 'direct') {
      const chatId = getChatId(user.is.alias, currentChat);
      gun.get(`chats`).get(chatId).set({
        sender: user.is.alias,
        content: content,
        timestamp: Date.now()
      });
    } else if (currentChatType === 'group') {
      gun.get(`groupChats`).get(currentChat).set({
        sender: user.is.alias,
        content: content,
        timestamp: Date.now()
      });
    }
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

createGroupBtn.addEventListener('click', createGroup);
addToGroupBtn.addEventListener('click', addUserToGroup);

startVoiceCallBtn.addEventListener('click', startVoiceCall);
endVoiceCallBtn.addEventListener('click', endVoiceCall);

// Initialize when the page loads
window.addEventListener('load', () => {
  initializeWebRTC()
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
    //loadContacts();
    //setupContactRequestListener();
    //setupContactAcceptanceListener(); 

    loadContacts();
    loadGroups();
    setupContactRequestListener();
    setupContactAcceptanceListener();
    setupGroupInvitationListener();
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

function createGroup() {
  const groupName = newGroupNameInput.value.trim();
  if (groupName) {
    const groupId = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const groupData = {
      name: groupName,
      creator: user.is.alias,
      members: {[user.is.alias]: true},  // Using an object instead of an array
      createdAt: Date.now()
    };
    
    gun.get('groups').get(groupId).put(groupData, (ack) => {
      if (ack.err) {
        alert('Error creating group: ' + ack.err);
      } else {
        user.get('groups').set(groupId);
        newGroupNameInput.value = '';
        loadGroups();
        alert('Group created successfully!');
      }
    });
  }
}

function loadGroups() {
  groupsList.innerHTML = '';
  user.get('groups').map().on((groupId) => {
    if (groupId) {
      gun.get('groups').get(groupId).once((groupData) => {
        if (groupData && groupData.name && !groupsList.querySelector(`[data-id="${groupId}"]`)) {
          const groupElement = document.createElement('div');
          groupElement.textContent = groupData.name;
          groupElement.dataset.id = groupId;
          groupElement.classList.add('group');
          groupElement.addEventListener('click', () => startGroupChat(groupId, groupData.name));
          groupsList.appendChild(groupElement);
        }
      });
    }
  });
}

function startGroupChat(groupId, groupName) {
  currentChat = groupId;
  currentChatType = 'group';
  currentChatHeader.textContent = `Group: ${groupName}`;
  messagesDiv.innerHTML = '';
  messageControls.classList.remove('hidden');
  callControls.classList.add('hidden');
  addToGroupBtn.classList.remove('hidden');
  addToGroupInput.classList.remove('hidden');
  loadGroupMessages(groupId);
}

function loadGroupMessages(groupId) {
  gun.get(`groupChats`).get(groupId).map().on((message, id) => {
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

function addUserToGroup() {
  const username = addToGroupInput.value.trim();
  if (username && currentChat && currentChatType === 'group') {
    gun.get('groups').get(currentChat).once((groupData) => {
      if (groupData.creator === user.is.alias) {
        if (!groupData.members[username]) {
          gun.get('groups').get(currentChat).get('members').get(username).put(true, (ack) => {
            if (ack.err) {
              alert('Error adding user to group: ' + ack.err);
            } else {
              // Send group invitation
              gun.get('users').get(username).get('groupInvitations').set({
                groupId: currentChat,
                from: user.is.alias,
                groupName: groupData.name,
                timestamp: Date.now()
              });
              
              addToGroupInput.value = '';
              alert(`Invitation sent to ${username}`);
            }
          });
        } else {
          alert(`${username} is already a member of this group`);
        }
      } else {
        alert('Only the group creator can add new members');
      }
    });
  }
}

function setupGroupInvitationListener() {
  gun.get('users').get(user.is.alias).get('groupInvitations').map().on((invitation, invitationId) => {
    if (invitation && !invitation.handled) {
      const accepted = confirm(`${invitation.from} invited you to join the group "${invitation.groupName}". Accept?`);
      if (accepted) {
        user.get('groups').set(invitation.groupId);
        gun.get('groups').get(invitation.groupId).get('members').get(user.is.alias).put(true);
        loadGroups();
      }
      gun.get('users').get(user.is.alias).get('groupInvitations').get(invitationId).put({...invitation, handled: true});
    }
  });
}

async function startVoiceCall() {
  if (isCallInProgress || currentChatType !== 'direct') {
    alert('A call is already in progress or you\'re not in a direct chat.');
    return;
  }

  try {
    isCallInProgress = true;
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log('Local stream obtained:', localStream.getTracks());
    
    peerConnection = await webrtcHandler.createPeerConnection();
    const offer = await webrtcHandler.startCall(localStream);
    
    const callId = Date.now().toString();
    currentCall = {
      id: callId,
      to: currentChat,
      from: user.is.alias,
      startTime: Date.now()
    };

    const offerData = {
      type: 'offer',
      callId: callId,
      from: user.is.alias,
      to: currentChat,
      offerType: offer.type,
      offerSdp: offer.sdp,
      startTime: currentCall.startTime
    };

    gun.get(`calls`).get(callId).put(offerData);
    console.log('Offer sent:', offerData);

    setupICECandidateListener(callId);
    
    startVoiceCallBtn.classList.add('hidden');
    endVoiceCallBtn.classList.remove('hidden');

    // Set a timeout to check if the call was established
    setTimeout(() => {
      if (peerConnection && peerConnection.iceConnectionState !== 'connected' && peerConnection.iceConnectionState !== 'completed') {
        console.log('Call setup timeout. Current ICE state:', peerConnection.iceConnectionState);
        alert('Call setup timed out. Please try again.');
        endVoiceCall();
      }
    }, 30000);  // 30 seconds timeout

  } catch (error) {
    console.error('Error starting voice call:', error);
    alert('Error starting voice call: ' + error.message);
    isCallInProgress = false;
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    currentCall = null;
  }
}

function endVoiceCall() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  remoteAudio.srcObject = null;
  if (currentCall) {
    gun.get(`calls`).get(currentCall.id).put({ 
      type: 'end',
      from: user.is.alias,
      to: currentCall.to,
      endTime: Date.now()
    });
    currentCall = null;
  }
  isCallInProgress = false;
  startVoiceCallBtn.classList.remove('hidden');
  endVoiceCallBtn.classList.add('hidden');
}

function initializeWebRTC() {
  webrtcHandler = new WebRTCHandler(
    handleICECandidate,
    (event) => {
      console.log('Received remote track:', event.track.kind);
      remoteAudio.srcObject = event.streams[0];
    }
  );
}


function sendIceCandidate(callId, candidate) {
  const simplifiedCandidate = {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex
  };
  gun.get(`calls`).get(callId).put({
    type: 'ice',
    from: user.is.alias,
    ice: JSON.stringify(simplifiedCandidate),
    time: Date.now()
  });
}

gun.on('auth', () => {
  console.log('User authenticated:', user.is.alias);
  gun.get(`calls`).map().on(async (data, key) => {
    if (!data || !data.to || data.to !== user.is.alias) return;
    
    console.log('Received call data:', data);
    
    if (data.type === 'ice') {
      handleIncomingIceCandidate(key, data);
    } else if (data.type === 'offer') {
      handleIncomingCall(data);
    } else if (data.type === 'answer' && peerConnection) {
      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription({
          type: data.answerType,
          sdp: data.answerSdp
        }));
      } catch (error) {
        console.error('Error setting remote description:', error);
      }
    } else if (data.type === 'end') {
      endVoiceCall();
    }
  });
});


function handleIncomingIceCandidate(callId, data) {
  if (data && data.ice) {
    try {
      const candidate = JSON.parse(data.ice);
      if (peerConnection) {
        webrtcHandler.addIceCandidate(new RTCIceCandidate(candidate))
          .catch(error => console.error('Error adding ICE candidate:', error));
      }
    } catch (error) {
      console.error('Error parsing ICE candidate:', error);
    }
  }
}

function checkAudioLevels(stream, label) {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  const dataArray = new Uint8Array(analyser.frequencyBinCount);

  function checkLevel() {
    analyser.getByteFrequencyData(dataArray);
    const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
    console.log(`${label} audio level:`, average);
    requestAnimationFrame(checkLevel);
  }

  checkLevel();
}

async function handleIncomingCall(data) {
  if (isCallInProgress) {
    console.log('Already in a call, ignoring incoming call');
    return;
  }

  const confirmed = confirm(`Incoming call from ${data.from}. Accept?`);
  if (confirmed) {
    try {
      isCallInProgress = true;
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('Local stream obtained:', localStream.getTracks());
      
      peerConnection = await webrtcHandler.createPeerConnection();
      
      const offer = {
        type: data.offerType,
        sdp: data.offerSdp
      };

      const answer = await webrtcHandler.handleIncomingCall(offer, localStream);
      
      currentCall = {
        id: data.callId,
        to: data.from,
        from: user.is.alias,
        startTime: Date.now()
      };

      const answerData = {
        type: 'answer',
        callId: data.callId,
        from: user.is.alias,
        to: data.from,
        answerType: answer.type,
        answerSdp: answer.sdp,
        time: currentCall.startTime
      };

      gun.get(`calls`).get(data.callId).put(answerData);
      console.log('Answer sent:', answerData);

      setupICECandidateListener(data.callId);
      
      startVoiceCallBtn.classList.add('hidden');
      endVoiceCallBtn.classList.remove('hidden');

      // Send buffered ICE candidates
      sendBufferedICECandidates(data.callId);

      // Set a timeout to check if the call was established
      setTimeout(() => {
        if (peerConnection && peerConnection.iceConnectionState !== 'connected' && peerConnection.iceConnectionState !== 'completed') {
          console.log('Call setup timeout. Current ICE state:', peerConnection.iceConnectionState);
          alert('Call setup timed out. Please try again.');
          endVoiceCall();
        }
      }, 30000);  // 30 seconds timeout

    } catch (error) {
      console.error('Error accepting call:', error);
      alert(`Error accepting call: ${error.message}`);
      endVoiceCall();
    }
  } else {
    gun.get(`calls`).get(data.callId).put({ 
      type: 'reject',
      from: user.is.alias,
      to: data.from,
      time: Date.now()
    });
  }
}

function handleICECandidate(event) {
  if (event.candidate) {
    const iceCandidate = {
      from: user.is.alias,
      candidate: {
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex
      },
      timestamp: Date.now()
    };
    localICECandidates.push(iceCandidate);
    
    if (currentCall) {
      sendICECandidate(currentCall.id, iceCandidate);
    } else {
      console.log('ICE candidate generated before call is established. Buffering...');
    }
  }
}

function sendICECandidate(callId, iceCandidate) {
  gun.get(`calls`).get(callId).get('iceCandidates').set(JSON.stringify(iceCandidate));
}

function sendBufferedICECandidates(callId) {
  localICECandidates.forEach(candidate => {
    sendICECandidate(callId, candidate);
  });
  localICECandidates = []; // Clear the buffer after sending
}

function setupICECandidateListener(callId) {
  gun.get(`calls`).get(callId).get('iceCandidates').map().on((stringifiedCandidate, key) => {
    if (stringifiedCandidate) {
      try {
        const iceCandidate = JSON.parse(stringifiedCandidate);
        if (iceCandidate && iceCandidate.from !== user.is.alias) {
          console.log('Received ICE candidate:', iceCandidate);
          webrtcHandler.addIceCandidate(iceCandidate.candidate);
        }
      } catch (error) {
        console.error('Error parsing ICE candidate:', error);
      }
    }
  });
}