const gun = Gun(['https://dcomm.dev.trustgrid.com/gun']);
const IPFS_BACKEND_URL = 'https://ipfs-backend.uat.trustgrid.com';

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
let isVideoCall = false;
let notificationService;
let typingTimeout;
const TYPING_TIMEOUT = 2000; 

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
const startVideoCallBtn = document.getElementById("startVideoCall");
const endCallBtn = document.getElementById('endCall');



async function register(e, loginUser, pass) {
  const username = loginUser || usernameInput.value.trim();
  const password = pass || passwordInput.value;
  
  if (!username || !password) {
    await showCustomAlert('Please enter both username and password');
    return;
  }
  
  user = gun.user();
  return new Promise((resolve, reject) => {
    user.create(username, password, (ack) => {
      if (ack.err) {
        console.log(ack.err);
        reject(new Error("registration Failed"));
      } else {
        // Store the user's public data
        gun.get('users').get(username).put({ username: username });
        console.log('Registration successful. You can now log in.');
        resolve(true);
      }
    });
  })
}

function login(e, loginUser, pass) {
  const username = loginUser || usernameInput.value.trim();
  const password = pass || passwordInput.value;
  console.log(username, password);
  user = gun.user();
  return new Promise((resolve, reject) => {
    user.auth(username, password, (ack) => {
      if (ack.err) {
        console.log(ack.err);
        reject(new Error("Login Failed"))
      } else {
        console.log("User authenticated:", user.is.alias);
        // Store/update the user's public data
        gun.get('users').get(username).put({ username: username });
        registerPushNotifications();
        initializeApp();
        resolve(true);
      }
    });
  })
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
  clearChat();
  currentChat = contactAlias;
  currentChatType = 'direct';
  currentChatHeader.textContent = `${contactAlias}`;
  messagesDiv.innerHTML = '';
  messageControls.classList.remove('hidden');
  callControls.classList.remove('hidden');
  addToGroupBtn.classList.add('hidden');
  addToGroupInput.classList.add('hidden');
  loadMessages(contactAlias);
}


function sendMessage() {
  const content = messageInput.value.trim();
  if (content && currentChat) {
    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }
    sendTypingStatus(false);
    if (currentChatType === 'direct') {
      const chatId = getChatId(user.is.alias, currentChat);
      gun.get(`chats`).get(chatId).set({
        sender: user.is.alias,
        content: content,
        timestamp: Date.now(),
        notified: false
      });
    } else if (currentChatType === 'group') {
      gun.get(`groupChats`).get(currentChat).set({
        sender: user.is.alias,
        content: content,
        timestamp: Date.now(),
        notified: false
      });
    }
    messageInput.value = '';
  }
}


function addContact() {
  const newContact = newContactInput.value.trim();
  if (newContact && newContact !== user.is.alias) {
    gun.get('users').get(newContact).once(async (userData) => {
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
        await showCustomAlert(`Contact request sent to ${newContact}`);
      } else {
        await showCustomAlert(`User ${newContact} does not exist.`);
      }
    });
  }
}

function listenForContactRequests() {
  console.log("I am running");
  user.get('contactRequests').map().on(async (request, requestId) => {
    console.log(request)
    if (request && request.from && !request.handled) {
      const confirmed = await showCustomConfirm(`${request.from} wants to add you as a contact. Accept?`);
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
// registerBtn.addEventListener('click', register);
// loginBtn.addEventListener('click', login);
sendMessageBtn.addEventListener('click', sendMessage);
addContactBtn.addEventListener('click', addContact);

createGroupBtn.addEventListener('click', createGroup);
addToGroupBtn.addEventListener('click', addUserToGroup);

// startVoiceCallBtn.addEventListener('click', startVoiceCall);
// endVoiceCallBtn.addEventListener('click', endVoiceCall);

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
    loadContacts();
    loadGroups();
    setupContactRequestListener();
    setupContactAcceptanceListener();
    setupGroupInvitationListener();
    setupTypingNotification();
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


async function handleContactRequest(request, requestId) {
  console.log("Handling contact request:", request, requestId);
  const confirmed = await showCustomConfirm(`${request.from} wants to add you as a contact. Accept?`);
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

    await showCustomAlert(`You are now connected with ${request.from}`);
  } else {
    // If rejected, remove the request instead of marking it as handled
    gun.get('users').get(user.is.alias).get('contactRequests').get(requestId).put(null, (ack) => {
      console.log("Removed rejected contact request:", ack);
    });
  }
}


function setupContactAcceptanceListener() {
  console.log("Setting up contact acceptance listener for", user.is.alias);
  gun.get('users').get(user.is.alias).get('contactAcceptances').map().on(async (acceptance, acceptanceId) => {
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
      
      await showCustomAlert(`${acceptance.from} has accepted your contact request!`);
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
    
    gun.get('groups').get(groupId).put(groupData, async (ack) => {
      if (ack.err) {
        await showCustomAlert('Error creating stream: ' + ack.err);
      } else {
        user.get('groups').set(groupId);
        newGroupNameInput.value = '';
        loadGroups();
        await showCustomAlert('Stream created successfully!');
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
  clearChat();
  currentChat = groupId;
  currentChatType = 'group';
  currentChatHeader.textContent = `Stream: ${groupName}`;
  messagesDiv.innerHTML = '';
  messageControls.classList.remove('hidden');
  callControls.classList.add('hidden');
  addToGroupBtn.classList.remove('hidden');
  addToGroupInput.classList.remove('hidden');
  loadGroupMessages(groupId);
}

// function loadGroupMessages(groupId) {
//   gun.get(`groupChats`).get(groupId).map().on((message, id) => {
//     if (message && !messagesDiv.querySelector(`[data-id="${id}"]`)) {
//       const messageElement = document.createElement('div');
//       messageElement.textContent = `${message.sender}: ${message.content}`;
//       messageElement.dataset.id = id;
//       messageElement.classList.add('message', message.sender === user.is.alias ? 'sent' : 'received');
//       messagesDiv.appendChild(messageElement);
//       messagesDiv.scrollTop = messagesDiv.scrollHeight;
//     }
//   });
// }

async function addUserToGroup() {
  const username = addToGroupInput.value.trim();
  if (username && currentChat && currentChatType === 'group') {
    gun.get('groups').get(currentChat).once(async (groupData) => {
      if (groupData.creator === user.is.alias) {
        if (!groupData.members[username]) {
          gun.get('groups').get(currentChat).get('members').get(username).put(true, async (ack) => {
            if (ack.err) {
              await showCustomAlert('Error adding user to stream: ' + ack.err);
            } else {
              // Send group invitation
              gun.get('users').get(username).get('groupInvitations').set({
                groupId: currentChat,
                from: user.is.alias,
                groupName: groupData.name,
                timestamp: Date.now()
              });
              
              addToGroupInput.value = '';
              await showCustomAlert(`Invitation sent to ${username}`);
            }
          });
        } else {
          await showCustomAlert(`${username} is already a member of this stream`);
        }
      } else {
        await showCustomAlert('Only the stream creator can add new members');
      }
    });
  }
}


function setupGroupInvitationListener() {
  gun.get('users').get(user.is.alias).get('groupInvitations').map().on(async (invitation, invitationId) => {
    if (invitation && !invitation.handled) {
      const accepted = await showCustomConfirm(`${invitation.from} invited you to join the stream "${invitation.groupName}". Accept?`);
      if (accepted) {
        user.get('groups').set(invitation.groupId);
        gun.get('groups').get(invitation.groupId).get('members').get(user.is.alias).put(true);
        loadGroups();
        
        // Remove the invitation after accepting
        gun.get('users').get(user.is.alias).get('groupInvitations').get(invitationId).put(null, (ack) => {
          console.log("Removed accepted stream invitation:", ack);
        });
      } else {
        // Remove the invitation if rejected
        gun.get('users').get(user.is.alias).get('groupInvitations').get(invitationId).put(null, (ack) => {
          console.log("Removed rejected stream invitation:", ack);
        });
      }
    }
  });
}


// async function startCall(withVideo = false) {
//   if (isCallInProgress || currentChatType !== 'direct') {
//     await showCustomAlert('A call is already in progress or you\'re not in a direct chat.');
//     return;
//   }

//   try {
//     isCallInProgress = true;
//     isVideoCall = withVideo;
//     const mediaConstraints = { audio: true, video: withVideo };
//     localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
//     console.log('Local stream obtained:', localStream.getTracks());
    
//     if (withVideo) {
//       document.getElementById('localVideo').srcObject = localStream;
//       document.getElementById('videoContainer').classList.remove('hidden');
//     }
    
//     peerConnection = await webrtcHandler.createPeerConnection();
//     const offer = await webrtcHandler.startCall(localStream);
    
//     const callId = Date.now().toString();
//     currentCall = {
//       id: callId,
//       to: currentChat,
//       from: user.is.alias,
//       startTime: Date.now(),
//       isVideo: withVideo
//     };

//     const offerData = {
//       type: 'offer',
//       callId: callId,
//       from: user.is.alias,
//       to: currentChat,
//       offerType: offer.type,
//       offerSdp: offer.sdp,
//       startTime: currentCall.startTime,
//       isVideo: withVideo,
//       status: 'pending'
//     };

//     gun.get(`calls`).get(callId).put(offerData);
//     console.log('Offer sent:', offerData);

//     setupICECandidateListener(callId);
    
//     startVoiceCallBtn.classList.add('hidden');
//     startVideoCallBtn.classList.add('hidden');
//     endCallBtn.classList.remove('hidden');

//     // Set a timeout to check if the call was established
//     setTimeout(async () => {
//       if (peerConnection && peerConnection.iceConnectionState !== 'connected' && peerConnection.iceConnectionState !== 'completed') {
//         console.log('Call setup timeout. Current ICE state:', peerConnection.iceConnectionState);
//         await showCustomAlert('Call setup timed out. Please try again.');
//         endCall();
//       }
//     }, 30000);  // 30 seconds timeout

//   } catch (error) {
//     console.error('Error starting call:', error);
//     await showCustomAlert('Error starting call: ' + error.message);
//     isCallInProgress = false;
//     if (localStream) {
//       localStream.getTracks().forEach(track => track.stop());
//     }
//     currentCall = null;
//   }
// }


function endCall() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  remoteAudio.srcObject = null;
  document.getElementById('remoteVideo').srcObject = null;
  document.getElementById('localVideo').srcObject = null;
  document.getElementById('videoContainer').classList.add('hidden');
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
  isVideoCall = false;
  startVoiceCallBtn.classList.remove('hidden');
  document.getElementById('startVideoCall').classList.remove('hidden');
  document.getElementById('endCall').classList.add('hidden');
}

function initializeWebRTC() {
  webrtcHandler = new WebRTCHandler(
    handleICECandidate,
    handleTrack
    // (event) => {
    //   console.log('Received remote track:', event.track.kind);
    //   remoteAudio.srcObject = event.streams[0];
    // }
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
    
    // console.log('Received call data:', data);
    
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
      endCall();
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


// async function handleIncomingCall(data) {
//   if (isCallInProgress) {
//     console.log('Already in a call, ignoring incoming call');
//     return;
//   }

//   const callType = data.isVideo ? 'video' : 'voice';
//   const confirmed = confirm(`Incoming ${callType} call from ${data.from}. Accept?`);
//   if (confirmed) {
//     try {
//       isCallInProgress = true;
//       isVideoCall = data.isVideo;
//       const mediaConstraints = { audio: true, video: data.isVideo };
//       localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
//       console.log('Local stream obtained:', localStream.getTracks());
      
//       if (data.isVideo) {
//         document.getElementById('localVideo').srcObject = localStream;
//         document.getElementById('videoContainer').classList.remove('hidden');
//       }
      
//       peerConnection = await webrtcHandler.createPeerConnection();
      
//       const offer = {
//         type: data.offerType,
//         sdp: data.offerSdp
//       };

//       const answer = await webrtcHandler.handleIncomingCall(offer, localStream);
      
//       currentCall = {
//         id: data.callId,
//         to: data.from,
//         from: user.is.alias,
//         startTime: Date.now(),
//         isVideo: data.isVideo
//       };

//       const answerData = {
//         type: 'answer',
//         callId: data.callId,
//         from: user.is.alias,
//         to: data.from,
//         answerType: answer.type,
//         answerSdp: answer.sdp,
//         time: currentCall.startTime,
//         isVideo: data.isVideo
//       };

//       gun.get(`calls`).get(data.callId).put(answerData);
//       console.log('Answer sent:', answerData);

//       setupICECandidateListener(data.callId);
      
//       startVoiceCallBtn.classList.add('hidden');
//       startVideoCallBtn.classList.add('hidden');
//       endCallBtn.classList.remove('hidden');

//       // Send buffered ICE candidates
//       sendBufferedICECandidates(data.callId);

//       // Set a timeout to check if the call was established
//       setTimeout(async () => {
//         if (peerConnection && peerConnection.iceConnectionState !== 'connected' && peerConnection.iceConnectionState !== 'completed') {
//           console.log('Call setup timeout. Current ICE state:', peerConnection.iceConnectionState);
//           await showCustomAlert('Call setup timed out. Please try again.');
//           endCall();
//         }
//       }, 30000);  // 30 seconds timeout

//     } catch (error) {
//       console.error('Error accepting call:', error);
//       await showCustomAlert(`Error accepting call: ${error.message}`);
//       endCall();
//     }
//   } else {
//     gun.get(`calls`).get(data.callId).put({ 
//       type: 'reject',
//       from: user.is.alias,
//       to: data.from,
//       time: Date.now()
//     });
//   }
// }

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

async function encryptAndUploadFile(file) {
  const fileBuffer = await file.arrayBuffer();
  const symKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedFile = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    symKey,
    fileBuffer
  );
  const encryptedBlob = new Blob([encryptedFile], { type: file.type });
  const formData = new FormData();
  formData.append('file', encryptedBlob, file.name);
  const response = await fetch(`${IPFS_BACKEND_URL}/upload`, {
    method: 'POST',
    body: formData
  });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const result = await response.json();
  const cid = result.ipfs.IpfsHash;
  const exportedSymKey = await crypto.subtle.exportKey("raw", symKey);
  console.log({
    cid: cid,
    encryptedSymKey: arrayBufferToBase64(exportedSymKey),
    iv: arrayBufferToBase64(iv),
    fileName: file.name,
    fileType: file.type
  });
  const data =  {
    cid: cid,
    encryptedSymKey: arrayBufferToBase64(exportedSymKey),
    iv: arrayBufferToBase64(iv),
    fileName: file.name,
    fileType: file.type
  };
  return JSON.stringify(data);
}


// async function sendFile() {
//   const fileInput = document.getElementById('fileInput');
  
//   if (!fileInput.files[0]) {
//     fileInput.click();
    
//     await new Promise(resolve => {
//       fileInput.onchange = () => resolve();
//     });
//   }
  
//   const file = fileInput.files[0];
//   if (file && file.type.startsWith('image/')) {
//     try {
//       displayImage(file);
//       const fileData = await encryptAndUploadFile(file);
      
//       if (currentChatType === 'direct') {
//         gun.get(`chats`).get(getChatId(user.is.alias, currentChat)).set({
//           sender: user.is.alias,
//           type: 'file',
//           content: fileData,
//           timestamp: Date.now()
//         });
//       } else if (currentChatType === 'group') {
//         gun.get(`groupChats`).get(currentChat).set({
//           sender: user.is.alias,
//           type: 'file',
//           content: fileData,
//           timestamp: Date.now()
//         });
//       }

//       console.log('File sent successfully!');
      
//       fileInput.value = '';
//     } catch (error) {
//       console.error('Error sending file:', error);
//       fileInput.value = '';
//       await showCustomAlert('Error sending file. Please try again.');
//     }
//   } else {
//     fileInput.value = '';
//     console.log('No file selected or file not supported. Image files only.');
//     await showCustomAlertalert('No file selected or file not supported. Image files only.');
//   }
// }

// async function receiveAndDecryptFile(fileData) {
//   try {
//     console.log(JSON.parse(fileData).cid);
//     const fileInfo = JSON.parse(fileData)
//     const response = await fetch(`${IPFS_BACKEND_URL}/getFile`, {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json',
//       },
//       body: JSON.stringify({ cid: fileInfo.cid })
//     });

//     if (!response.ok) {
//       throw new Error(`HTTP error! status: ${response.status}`);
//     }

//     const result = await response.json();
//     const fileUrl = result.result;
//     const encryptedFileResponse = await fetch(fileUrl);
//     if (!encryptedFileResponse.ok) {
//       throw new Error(`File download failed: ${encryptedFileResponse.statusText}`);
//     }

//     // Get the total size of the file (if available)
//     const totalSize = parseInt(encryptedFileResponse.headers.get('Content-Length') || '0');
//     let downloadedSize = 0;

//     // Create a ReadableStream from the response body
//     const reader = encryptedFileResponse.body.getReader();
//     const chunks = [];

//     while (true) {
//       const { done, value } = await reader.read();
//       if (done) break;
//       chunks.push(value);
//       downloadedSize += value.length;

//       // Update download progress
//       if (totalSize > 0) {
//         const progress = (downloadedSize / totalSize) * 100;
//         console.log(`Download progress: ${progress.toFixed(2)}%`);
//         // You can update a progress bar or other UI element here
//       }
//     }

//     // Combine all chunks into a single Uint8Array
//     const encryptedFile = new Uint8Array(downloadedSize);
//     let position = 0;
//     for (const chunk of chunks) {
//       encryptedFile.set(chunk, position);
//       position += chunk.length;
//     }
//     const symKey = await crypto.subtle.importKey(
//       "raw",
//       base64ToArrayBuffer(fileInfo.encryptedSymKey),
//       { name: "AES-GCM", length: 256 },
//       false,
//       ["decrypt"]
//     );
//     const decryptedFile = await crypto.subtle.decrypt(
//       { name: "AES-GCM", iv: base64ToArrayBuffer(fileInfo.iv) },
//       symKey,
//       encryptedFile
//     );
//     const blob = new Blob([decryptedFile], { type: fileInfo.fileType });
//     displayImage(blob);
//   } catch (error) {
//     console.error('Error receiving file:', error);
//     await showCustomAlert('Error receiving file. Please try again.');
//   }
// }

async function showExpiryDialog() {
  const dialogHtml = `
    <div class="dialog-content">
      <p>Set file expiration time (in minutes)</p>
      <p>Enter 0 for no expiration</p>
      <input type="number" min="0" id="expiryInput" class="input-box-style" value="0">
      <div class="dialog-buttons">
        <button class="primary-button-style" id="confirmExpiry">Confirm</button>
        <button class="primary-button-style" id="cancelExpiry">Cancel</button>
      </div>
    </div>
  `;

  const dialog = document.createElement('div');
  dialog.className = 'custom-dialog';
  dialog.innerHTML = dialogHtml;
  document.body.appendChild(dialog);

  return new Promise((resolve) => {
    document.getElementById('confirmExpiry').onclick = () => {
      const minutes = parseInt(document.getElementById('expiryInput').value) || 0;
      document.body.removeChild(dialog);
      resolve(minutes);
    };
    document.getElementById('cancelExpiry').onclick = () => {
      document.body.removeChild(dialog);
      resolve(null);
    };
  });
}

function getFileType(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('application/') || file.type.startsWith('text/')) return 'document';
  return 'other';
}

async function sendFile() {
  const fileInput = document.getElementById('fileInput');
  
  if (!fileInput.files[0]) {
    fileInput.click();
    await new Promise(resolve => {
      fileInput.onchange = () => resolve();
    });
  }
  
  const file = fileInput.files[0];
  if (!file) {
    await showCustomAlert('No file selected.');
    return;
  }

  const fileType = getFileType(file);
  if (fileType === 'other') {
    await showCustomAlert('Unsupported file type. Please select an image, video, or document.');
    fileInput.value = '';
    return;
  }

  try {
    // Show expiry dialog
    //const expiryMinutes = await showExpiryDialog();
    const expiryMinutes = 0;
    if (expiryMinutes === null) {
      fileInput.value = '';
      return;
    }

    // Calculate expiry timestamp
    const expiryTime = expiryMinutes === 0 ? Number.MAX_SAFE_INTEGER : Date.now() + (expiryMinutes * 60 * 1000);
    
    // Display preview
    displayFilePreview(file, fileType);
    
    // Encrypt and upload
    const fileData = await encryptAndUploadFile(file);
    const fileInfo = JSON.parse(fileData);
    fileInfo.expiryTime = expiryTime;
    fileInfo.fileType = fileType;
    
    // Send message
    const chatData = {
      sender: user.is.alias,
      type: 'file',
      content: JSON.stringify(fileInfo),
      timestamp: Date.now()
    };

    if (currentChatType === 'direct') {
      gun.get(`chats`).get(getChatId(user.is.alias, currentChat)).set(chatData);
    } else if (currentChatType === 'group') {
      gun.get(`groupChats`).get(currentChat).set(chatData);
    }

    console.log('File sent successfully!');
    fileInput.value = '';
  } catch (error) {
    console.error('Error sending file:', error);
    fileInput.value = '';
    await showCustomAlert('Error sending file. Please try again.');
  }
}

async function receiveAndDecryptFile(fileData) {
  try {
    const fileInfo = JSON.parse(fileData);
    
    // Check expiration
    if (fileInfo.expiryTime && fileInfo.expiryTime < Date.now()) {
      throw new Error('File has expired');
    }
    
    const response = await fetch(`${IPFS_BACKEND_URL}/getFile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cid: fileInfo.cid })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    const fileUrl = result.result;
    const encryptedFileResponse = await fetch(fileUrl);
    if (!encryptedFileResponse.ok) {
      throw new Error(`File download failed: ${encryptedFileResponse.statusText}`);
    }

    // Handle download progress
    const totalSize = parseInt(encryptedFileResponse.headers.get('Content-Length') || '0');
    let downloadedSize = 0;
    const chunks = [];
    const reader = encryptedFileResponse.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      downloadedSize += value.length;

      if (totalSize > 0) {
        const progress = (downloadedSize / totalSize) * 100;
        console.log(`Download progress: ${progress.toFixed(2)}%`);
      }
    }

    const encryptedFile = new Uint8Array(downloadedSize);
    let position = 0;
    for (const chunk of chunks) {
      encryptedFile.set(chunk, position);
      position += chunk.length;
    }

    const symKey = await crypto.subtle.importKey(
      "raw",
      base64ToArrayBuffer(fileInfo.encryptedSymKey),
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );

    const decryptedFile = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToArrayBuffer(fileInfo.iv) },
      symKey,
      encryptedFile
    );

    const blob = new Blob([decryptedFile], { type: fileInfo.fileType });
    displayFilePreview(blob, fileInfo.fileType, true);
  } catch (error) {
    console.error('Error receiving file:', error);
    if (error.message === 'File has expired') {
      await showCustomAlert('This file has expired and is no longer available.');
    } else {
      await showCustomAlert('Error receiving file. Please try again.');
    }
  }
}

async function deleteFileFromIPFS(cid) {
  try {
    const response = await fetch(`${IPFS_BACKEND_URL}/deleteFile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cid: cid })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('File deleted:', result);
  } catch (error) {
    console.error('Error deleting file:', error);
  }
}

// function loadMessages(contactAlias) {
//   const chatId = getChatId(user.is.alias, contactAlias);
//   gun.get(`chats`).get(chatId).map().on((message, id) => {
//     if (message && !messagesDiv.querySelector(`[data-id="${id}"]`)) {
//       const messageElement = document.createElement('div');
//       if (message.type === 'file') {
//         console.log(message);
//         try {
//           message.content = JSON.parse(message.content);
//         } catch (err) {
//           message = message;
//         }
//         messageElement.textContent = `${message.sender} sent a file: ${message.content.fileName}`;
//         const downloadButton = document.createElement('button');
//         downloadButton.textContent = 'Download';
//         downloadButton.addEventListener('click', () => receiveAndDecryptFile(message.content));
//         messageElement.appendChild(downloadButton);
//       } else {
//         messageElement.textContent = `${message.sender}: ${message.content}`;
//       }
//       messageElement.dataset.id = id;
//       messageElement.classList.add('message', message.sender === user.is.alias ? 'sent' : 'received');
//       messagesDiv.appendChild(messageElement);
//       messagesDiv.scrollTop = messagesDiv.scrollHeight;
//     }
//   });
// }

function loadMessages(contactAlias) {
  const chatId = getChatId(user.is.alias, contactAlias);
  gun.get(`chats`).get(chatId).map().on((message, id) => {
    displayMessage(message, id);
  });
}

function loadGroupMessages(groupId) {
  gun.get(`groupChats`).get(groupId).map().on((message, id) => {
    displayMessage(message, id);
  });
}

// function displayMessage(message, id) {
//   if (message && !messagesDiv.querySelector(`[data-id="${id}"]`)) {
//     const messageElement = document.createElement('div');
//     if (message.type === 'file' && message.content) {
//       console.log(message);
//       try {
//         message.content = JSON.parse(message.content);
//       } catch (err) {
//         console.error('Error parsing file content:', err);
//       }
//       messageElement.textContent = `${message.sender} sent a file: ${message.content.fileName}`;
//       const downloadButton = document.createElement('button');
//       downloadButton.textContent = 'Download';
//       downloadButton.addEventListener('click', () => receiveAndDecryptFile(message.content));
//       messageElement.appendChild(downloadButton);
//     } else {
//       messageElement.textContent = `${message.sender}: ${message.content}`;
//     }
//     messageElement.dataset.id = id;
//     messageElement.classList.add('message', message.sender === user.is.alias ? 'sent' : 'received');
//     messagesDiv.appendChild(messageElement);
//     messagesDiv.scrollTop = messagesDiv.scrollHeight;
//   }
// }

function displayMessage(message, id) {
  if (message && !messagesDiv.querySelector(`[data-id="${id}"]`)) {
    const messageElement = document.createElement('div');
    if (message.type === 'file' && message.content) {
      try {
        const fileInfo = JSON.parse(message.content);
        const isExpired = fileInfo.expiryTime && fileInfo.expiryTime < Date.now();
        
        messageElement.textContent = `${message.sender} sent a ${fileInfo.fileType}: ${fileInfo.fileName}`;
        
        if (!isExpired) {
          const downloadButton = document.createElement('button');
          downloadButton.textContent = 'Download';
          downloadButton.className = 'primary-button-style';
          downloadButton.addEventListener('click', () => receiveAndDecryptFile(message.content));
          messageElement.appendChild(downloadButton);
        } else {
          const expiredText = document.createElement('span');
          expiredText.textContent = ' (Expired)';
          expiredText.style.color = '#ff4444';
          messageElement.appendChild(expiredText);
        }
      } catch (err) {
        console.error('Error parsing file content:', err);
        messageElement.textContent = `${message.sender}: Error displaying file`;
      }
    } else {
      messageElement.textContent = `${message.sender}: ${message.content}`;
    }
    
    messageElement.dataset.id = id;
    messageElement.classList.add('message', message.sender === user.is.alias ? 'sent' : 'received');
    messagesDiv.appendChild(messageElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

function displayImage(blob) {
  const url = URL.createObjectURL(blob);
  const img = document.createElement('img');
  img.src = url;
  img.style.maxWidth = '200px';
  img.style.maxHeight = '200px';
  
  const messagesDiv = document.getElementById('messages');
  messagesDiv.appendChild(img);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function handleTrack(event) {
  console.log('Received remote track:', event.track.kind);
  if (event.track.kind === 'audio') {
    remoteAudio.srcObject = event.streams[0];
  } else if (event.track.kind === 'video') {
    const remoteVideo = document.getElementById('remoteVideo');
    remoteVideo.srcObject = event.streams[0];
  }
}

function displayFilePreview(blob, fileType, received=false) {
  const url = URL.createObjectURL(blob);
  const container = document.createElement('div');
  container.className = 'file-preview';
  
  let element;
  switch (fileType) {
    case 'image':
      element = document.createElement('img');
      element.src = url;
      element.style.maxWidth = '200px';
      element.style.maxHeight = '200px';
      break;
    case 'video':
      element = document.createElement('video');
      element.src = url;
      element.controls = true;
      element.style.maxWidth = '200px';
      element.style.maxHeight = '200px';
      break;
    case 'document':
      element = document.createElement('div');
      element.className = 'document-preview';
      element.innerHTML = `
        <i class="document-icon">📄</i>
        <span>${blob.name}</span>
      `;
      break;
  }
  
  container.appendChild(element);
  messagesDiv.appendChild(container);
  if (!received) {
    container.classList.add('sent');
  }
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

document.getElementById('sendFile').addEventListener('click', sendFile);

startVoiceCallBtn.addEventListener('click', () => startCall(false));
document.getElementById('startVideoCall').addEventListener('click', () => startCall(true));
document.getElementById('endCall').addEventListener('click', endCall);

function setupTypingNotification() {
  messageInput.addEventListener('input', handleTypingEvent);
  messageInput.addEventListener('blur', () => {
    if (typingTimeout) clearTimeout(typingTimeout);
    sendTypingStatus(false);
  });
  listenForTypingNotifications();
}

function handleTypingEvent() {
  if (!currentChat || !messageInput.value.trim()) {
    sendTypingStatus(false);
    return;
  }
  if (typingTimeout) clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    sendTypingStatus(false);
  }, TYPING_TIMEOUT);
  sendTypingStatus(true);
}

function sendTypingStatus(isTyping) {
  if (!currentChat || !user) return;

  const typingData = {
    user: user.is.alias,
    isTyping: isTyping,
    timestamp: Date.now()
  };

  if (currentChatType === 'direct') {
    gun.get('typing').get(getChatId(user.is.alias, currentChat)).put(typingData);
  } else if (currentChatType === 'group') {
    gun.get('groupTyping').get(currentChat).get(user.is.alias).put(typingData);
  }
}

function listenForTypingNotifications() {
  // For direct chats
  gun.get('typing').map().on((data, chatId) => {
    if (!data || !data.user || data.user === user.is.alias) return;

    // Only show typing indicator if it's for the current chat
    if (currentChatType === 'direct' && 
        chatId === getChatId(user.is.alias, currentChat)) {
      updateTypingIndicator(data.user, data.isTyping);
    }
  });

  // For group chats
  gun.get('groupTyping').map().on((groupData, groupId) => {
    if (currentChatType === 'group' && groupId === currentChat) {
      gun.get('groupTyping').get(groupId).map().on((data) => {
        if (!data || !data.user || data.user === user.is.alias) return;
        updateTypingIndicator(data.user, data.isTyping);
      });
    }
  });
}

function updateTypingIndicator(username, isTyping) {
  const typingIndicatorId = `typing-${username}`;
  let typingIndicator = document.getElementById(typingIndicatorId);

  if (isTyping) {
    if (!typingIndicator) {
      typingIndicator = document.createElement('div');
      typingIndicator.id = typingIndicatorId;
      typingIndicator.className = 'typing-indicator';
      
      const dotContainer = document.createElement('div');
      dotContainer.className = 'typing-dots';
      for (let i = 0; i < 3; i++) {
        const dot = document.createElement('span');
        dot.className = 'dot';
        dotContainer.appendChild(dot);
      }
      
      typingIndicator.innerHTML = `
        <span class="typing-text">${username} is typing</span>
      `;
      typingIndicator.appendChild(dotContainer);
      
      const typingContainer = document.getElementById('typingContainer');
      if (!typingContainer.contains(typingIndicator)) {
        typingContainer.appendChild(typingIndicator);
        
        // Only scroll if user is near bottom
        const messages = document.getElementById('messages');
        const isNearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 100;
        if (isNearBottom) {
          messages.scrollTop = messages.scrollHeight;
        }
      }
    }
  } else if (typingIndicator) {
    typingIndicator.remove();
  }
}

// function clearTypingIndicators() {
//   const typingContainer = document.getElementById('typingContainer');
//   typingContainer.innerHTML = '';
//   if (typingTimeout) {
//     clearTimeout(typingTimeout);
//     sendTypingStatus(false);
//   }
// }

function clearChat() {
  if (typingTimeout) {
    clearTimeout(typingTimeout);
  }
  sendTypingStatus(false);
  messageInput.value = '';
  messagesDiv.innerHTML = '';
  currentChat = null;
  currentChatType = null;
}

async function registerPushNotifications() {
  try {
    if (!('Notification' in window)) return;
    console.log("Requesting permission");

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    const registration = await navigator.serviceWorker.register('/notification-worker.js');
    console.log('Service Worker registered');

    const response = await fetch('/vapidPublicKey');
    const { key } = await response.json();

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key)
    });

    const deviceId = generateDeviceId();
    console.log('Storing subscription for device:', deviceId);

    // Store subscription
    const deviceData = {
      subscription: JSON.stringify(subscription),
      deviceInfo: {
        userAgent: navigator.userAgent,
        lastSeen: Date.now(),
        deviceId: deviceId
      }
    };

    console.log('Storing device data:', deviceData);

    // Store and verify
    gun.get('users').get(user.is.alias).get('devices').get(deviceId).put(deviceData, (ack) => {
      if (ack.err) {
        console.error('Error storing subscription:', ack.err);
      } else {
        console.log('Subscription stored successfully');
        // Verify storage
        gun.get('users').get(user.is.alias).get('devices').get(deviceId).once((data) => {
          console.log('Stored data verification:', data);
        });
      }
    });

  } catch (error) {
    console.error('Push subscription failed:', error);
  }
}

function generateDeviceId() {
  let deviceId = localStorage.getItem('deviceId');
  if (!deviceId) {
    deviceId = `device_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem('deviceId', deviceId);
  }
  return deviceId;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');
  
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  
  return outputArray;
}


async function startCall(withVideo = false) {
  if (isCallInProgress || currentChatType !== 'direct') {
    await showCustomAlert('A call is already in progress or you\'re not in a direct chat.');
    return;
  }

  try {
    isCallInProgress = true;
    isVideoCall = withVideo;
    const mediaConstraints = { audio: true, video: withVideo };
    localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
    console.log('Local stream obtained:', localStream.getTracks());
    
    if (withVideo) {
      document.getElementById('localVideo').srcObject = localStream;
      document.getElementById('videoContainer').classList.remove('hidden');
    }
    
    peerConnection = await webrtcHandler.createPeerConnection();
    const offer = await webrtcHandler.startCall(localStream);
    
    const callId = Date.now().toString();
    currentCall = {
      id: callId,
      to: currentChat,
      from: user.is.alias,
      startTime: Date.now(),
      isVideo: withVideo
    };

    // Create the call data structure
    const callData = {
      type: 'offer',
      callId: callId,
      from: user.is.alias,
      to: currentChat,
      offerType: offer.type,
      offerSdp: offer.sdp,
      startTime: currentCall.startTime,
      isVideo: withVideo,
      status: 'pending'
    };

    // Save call data with explicit path
    gun.get('calls').get(callId).put(callData, (ack) => {
      if (ack.err) {
        console.error('Error saving call data:', ack.err);
        endCall();
        return;
      }
      console.log('Call data saved successfully:', callData);
    });

    // Verify the call data was saved
    gun.get('calls').get(callId).once((data) => {
      console.log('Verified call data:', data);
    });

    // Setup ICE candidate handling
    setupICECandidateListener(callId);
    
    // Update UI
    startVoiceCallBtn.classList.add('hidden');
    startVideoCallBtn.classList.add('hidden');
    endCallBtn.classList.remove('hidden');

    // Set a timeout to check if the call was established
    setTimeout(async () => {
      gun.get('calls').get(callId).once((data) => {
        if (data?.status === 'pending') {
          console.log('Call setup timeout. Status:', data?.status);
          showCustomAlert('Call setup timed out. Please try again.');
          endCall();
        }
      });
    }, 30000);

  } catch (error) {
    console.error('Error starting call:', error);
    await showCustomAlert('Error starting call: ' + error.message);
    isCallInProgress = false;
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    currentCall = null;
  }
}

// Add a function to monitor call state
function monitorCallState(callId) {
  return new Promise((resolve) => {
    const unsubscribe = gun.get('calls').get(callId).on((data) => {
      console.log('Call state updated:', data);
      if (data?.status === 'accepted' || data?.status === 'rejected') {
        unsubscribe();
        resolve(data.status);
      }
    });
  });
}

// Modify the handleIncomingCall function:
async function handleIncomingCall(data) {
  if (isCallInProgress) {
    console.log('Already in a call, rejecting incoming call');
    gun.get('calls').get(data.callId).put({
      ...data,
      status: 'rejected',
      reason: 'busy'
    });
    return;
  }

  const callType = data.isVideo ? 'video' : 'voice';
  const confirmed = confirm(`Incoming ${callType} call from ${data.from}. Accept?`);
  
  if (confirmed) {
    try {
      // Update call status
      gun.get('calls').get(data.callId).put({
        ...data,
        status: 'accepted',
        acceptTime: Date.now()
      });

      isCallInProgress = true;
      isVideoCall = data.isVideo;
      const mediaConstraints = { audio: true, video: data.isVideo };
      localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
      
      if (data.isVideo) {
        document.getElementById('localVideo').srcObject = localStream;
        document.getElementById('videoContainer').classList.remove('hidden');
      }
      
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
        startTime: Date.now(),
        isVideo: data.isVideo
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

      gun.get('calls').get(data.callId).put(answerData);
      
      // Update UI
      startVoiceCallBtn.classList.add('hidden');
      startVideoCallBtn.classList.add('hidden');
      endCallBtn.classList.remove('hidden');

    } catch (error) {
      console.error('Error accepting call:', error);
      gun.get('calls').get(data.callId).put({
        ...data,
        status: 'failed',
        error: error.message
      });
      await showCustomAlert(`Error accepting call: ${error.message}`);
      endCall();
    }
  } else {
    gun.get('calls').get(data.callId).put({
      ...data,
      status: 'rejected',
      reason: 'declined',
      time: Date.now()
    });
  }
}


(async function () {
  const urlString = window.location.href;
  const url = new URL(urlString);
  const username = url.searchParams.get('username');
  let password = url.searchParams.get('password');
  password += "Trus@"+password;
  if (username && password) {
    try {
      await login(null, username.trim(), password.trim());
    } catch (err) {
      console.log(err);
      await register(null, username.trim(), password.trim());
      await login(null, username.trim(), password.trim());
    } 
  }
})();



