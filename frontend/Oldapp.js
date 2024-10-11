// frontend/app.js

// Initialize Gun
const gun = Gun();

// User state
let username = '';
let localStream = null;
let peerConnection = null;

// ICE Servers for WebRTC (Using public STUN servers)
const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    // Optional: Add TURN servers if needed
  ]
};

// DOM Elements
const authDiv = document.getElementById('auth');
const chatDiv = document.getElementById('chat');
const loginBtn = document.getElementById('login');
const usernameInput = document.getElementById('username');

const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessage');

const startVoiceBtn = document.getElementById('startVoice');
const endVoiceBtn = document.getElementById('endVoice');
const remoteAudio = document.getElementById('remoteAudio');

const startVideoBtn = document.getElementById('startVideo');
const endVideoBtn = document.getElementById('endVideo');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

// Login Function
loginBtn.addEventListener('click', () => {
  const inputUsername = usernameInput.value.trim();
  if (inputUsername) {
    username = inputUsername;
    authDiv.classList.add('hidden');
    chatDiv.classList.remove('hidden');
    initializeChat();
    setupWebRTC();
  }
});

// Initialize Chat
function initializeChat() {
  // Listen for messages from Gun
  gun.get('messages').map().on((msg, id) => {
    if (msg && msg.sender && msg.content) {
      displayMessage(msg.sender, msg.content);
    }
  });
}

// Display Message
function displayMessage(sender, content) {
  const messageDiv = document.createElement('div');
  messageDiv.innerHTML = `<strong>${sender}:</strong> ${content}`;
  messagesDiv.appendChild(messageDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Send Message
sendMessageBtn.addEventListener('click', () => {
  const content = messageInput.value.trim();
  if (content) {
    gun.get('messages').set({ sender: username, content });
    messageInput.value = '';
  }
});

// Setup WebRTC
function setupWebRTC() {
    gun.get('webrtc').map().on(async (data, key) => {
        const [sender, receiver] = key.split(':');
        if (receiver !== username) return; // Only handle messages intended for this user
    
        if (data.offer && !peerConnection) {
          await handleOffer(sender, data.offer);
        }
    
        if (data.answer && peerConnection) {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
    
        if (data.candidate && peerConnection) {
          try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch (e) {
            console.error('Error adding received ice candidate', e);
          }
        }
    });
}

// Voice Call Functionality
startVoiceBtn.addEventListener('click', async () => {
  await startVoiceCall();
});

endVoiceBtn.addEventListener('click', () => {
  endVoiceCall();
});

async function startVoiceCall() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Initialize Peer Connection
    peerConnection = new RTCPeerConnection(configuration);
    
    // Add local audio stream to peer connection
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
    
    // Create Offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    // Send Offer via Gun.js
    gun.get('webrtc').put({ offer: offer });
    
    // Listen for Answer
    gun.get('webrtc').map().on(async (data, key) => {
      if (data.answer && !peerConnection.currentRemoteDescription) {
        const remoteDesc = new RTCSessionDescription(data.answer);
        await peerConnection.setRemoteDescription(remoteDesc);
      }
    });
    
    // Handle ICE Candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        gun.get('webrtc').put({ candidate: event.candidate });
      }
    };
    
    // Handle Remote Stream
    peerConnection.ontrack = (event) => {
      remoteAudio.srcObject = event.streams[0];
    };
  } catch (error) {
    console.error('Error starting voice call:', error);
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
}

// Video Call Functionality
startVideoBtn.addEventListener('click', async () => {
  await startVideoCall();
});

endVideoBtn.addEventListener('click', () => {
  endVideoCall();
});

async function startVideoCall() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    localVideo.srcObject = localStream;
    
    // Initialize Peer Connection
    peerConnection = new RTCPeerConnection(configuration);
    
    // Add local stream to peer connection
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
    
    // Create Offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    // Send Offer via Gun.js
    gun.get('webrtc').put({ offer: offer });
    
    // Listen for Answer
    gun.get('webrtc').map().on(async (data, key) => {
      if (data.answer && !peerConnection.currentRemoteDescription) {
        const remoteDesc = new RTCSessionDescription(data.answer);
        await peerConnection.setRemoteDescription(remoteDesc);
      }
    });
    
    // Handle ICE Candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        gun.get('webrtc').put({ candidate: event.candidate });
      }
    };
    
    // Handle Remote Stream
    peerConnection.ontrack = (event) => {
      remoteVideo.srcObject = event.streams[0];
    };
  } catch (error) {
    console.error('Error starting video call:', error);
  }
}

function endVideoCall() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
}

// Listen for incoming offers
gun.get('webrtc').map().on(async (data, key) => {
  if (data.offer && !peerConnection) {
    await receiveOffer(data.offer);
  }
  
  if (data.candidate && peerConnection) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (e) {
      console.error('Error adding received ice candidate', e);
    }
  }
});

async function receiveOffer(offer) {
  try {
    // Initialize Peer Connection
    peerConnection = new RTCPeerConnection(configuration);
    
    // Handle ICE Candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        gun.get('webrtc').put({ candidate: event.candidate });
      }
    };
    
    // Handle Remote Stream
    peerConnection.ontrack = (event) => {
      if (remoteAudio.srcObject === null) {
        remoteAudio.srcObject = event.streams[0];
      }
      if (remoteVideo.srcObject === null) {
        remoteVideo.srcObject = event.streams[0];
      }
    };
    
    // Set Remote Description
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    
    // Get User Media
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
    
    // Create Answer
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    // Send Answer via Gun.js
    gun.get('webrtc').put({ answer: answer });
  } catch (error) {
    console.error('Error receiving offer:', error);
  }
}

const peers = {};

// Listen for incoming offers and candidates
gun.get('webrtc').map().on(async (data, key) => {
  const [fromUser, toUser] = key.split(':');
  if (toUser !== username) return; // Only handle messages intended for this user

  if (data.offer) {
    await receiveOffer(data.offer, fromUser);
  }

  if (data.answer) {
    const peer = peers[fromUser];
    if (peer) {
      await peer.setRemoteDescription(new RTCSessionDescription(data.answer));
    }
  }

  if (data.candidate) {
    const peer = peers[fromUser];
    if (peer) {
      try {
        await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (e) {
        console.error('Error adding received ice candidate', e);
      }
    }
  }
});

// Function to initiate a call to another user
async function initiateCall(targetUser) {
  if (peers[targetUser]) {
    console.warn('Already connected to', targetUser);
    return;
  }

  const peer = new RTCPeerConnection(configuration);
  peers[targetUser] = peer;

  // Add local stream
  if (localStream) {
    localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
  }

  // Handle remote stream
  peer.ontrack = (event) => {
    // Handle remote audio/video
    // You can enhance this to support multiple streams
    remoteAudio.srcObject = event.streams[0];
    remoteVideo.srcObject = event.streams[0];
  };

  // Handle ICE candidates
  peer.onicecandidate = (event) => {
    if (event.candidate) {
      gun.get('webrtc').put({ [username + ':' + targetUser]: { candidate: event.candidate } });
    }
  };

  // Create Offer
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);

  // Send Offer via Gun.js
  gun.get('webrtc').put({ [username + ':' + targetUser]: { offer: offer } });

  // Listen for Answer
  gun.get('webrtc').map().on(async (data, key) => {
    if (key === `${targetUser}:${username}` && data.answer) {
      await peer.setRemoteDescription(new RTCSessionDescription(data.answer));
    }
  });
}

// Function to receive an offer
async function receiveOffer(offer, fromUser) {
  if (peers[fromUser]) {
    console.warn('Already connected to', fromUser);
    return;
  }

  const peer = new RTCPeerConnection(configuration);
  peers[fromUser] = peer;

  // Handle remote stream
  peer.ontrack = (event) => {
    remoteAudio.srcObject = event.streams[0];
    remoteVideo.srcObject = event.streams[0];
  };

  // Handle ICE candidates
  peer.onicecandidate = (event) => {
    if (event.candidate) {
      gun.get('webrtc').put({ [username + ':' + fromUser]: { candidate: event.candidate } });
    }
  };

  // Add local stream
  if (localStream) {
    localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
  }

  // Set Remote Description
  await peer.setRemoteDescription(new RTCSessionDescription(offer));

  // Create Answer
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);

  // Send Answer via Gun.js
  gun.get('webrtc').put({ [username + ':' + fromUser]: { answer: answer } });
}

// UI for Initiating Calls
// Add input field to specify target user

// Modify HTML to include target user input for calls
// Add below in the HTML within the chat div:

/*
<div id="callSection">
  <input type="text" id="targetUser" placeholder="Enter Username to Call">
  <button id="callBtn">Call</button>
</div>
*/

// Add corresponding JavaScript:

const targetUserInput = document.createElement('input');
targetUserInput.type = 'text';
targetUserInput.id = 'targetUser';
targetUserInput.placeholder = 'Enter Username to Call';

const callBtn = document.createElement('button');
callBtn.id = 'callBtn';
callBtn.innerText = 'Call';

const callSection = document.createElement('div');
callSection.id = 'callSection';
callSection.appendChild(targetUserInput);
callSection.appendChild(callBtn);
chatDiv.appendChild(callSection);

callBtn.addEventListener('click', () => {
  const targetUser = targetUserInput.value.trim();
  if (targetUser && targetUser !== username) {
    initiateCall(targetUser);
  }
});

const SEA = Gun.SEA;

// Register Function
async function register(username, password) {
  try {
    const user = gun.user();
    await user.create(username, password);
    console.log('User registered:', username);
  } catch (error) {
    console.error('Registration Error:', error);
  }
}

// Login Function
async function login(username, password) {
  try {
    const user = gun.user();
    await user.auth(username, password);
    console.log('User logged in:', username);
  } catch (error) {
    console.error('Login Error:', error);
  }
}

// Modify login button to handle authentication
loginBtn.addEventListener('click', async () => {
  const inputUsername = usernameInput.value.trim();
  if (inputUsername) {
    username = inputUsername;
    // Prompt for password
    const password = prompt('Enter Password:');
    if (password) {
      try {
        await login(username, password);
        authDiv.classList.add('hidden');
        chatDiv.classList.remove('hidden');
        initializeChat();
        setupWebRTC();
      } catch (error) {
        alert('Authentication Failed');
      }
    }
  }
});
