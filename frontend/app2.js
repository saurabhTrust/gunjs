const gun = Gun(['https://localhost:8443/gun']);

// User state
let user;
let currentCall = null;
let webrtcHandler;
let currentRoom = 'global';
let iceCandidateBuffer = [];
let peerConnection = null;
let pendingOffer = null;
let isCallInProgress = false;
let localStream;
let iceCandidates = {};
let isIncomingCallHandled = false;


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
const startVoiceBtn = document.getElementById('startVoice');
const endVoiceBtn = document.getElementById('endVoice');
const callToInput = document.getElementById('callTo');
const remoteAudio = document.getElementById('remoteAudio');


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

function handleIncomingIceCandidate(callId, data) {
  if (data && data.ice) {
      try {
          const candidate = JSON.parse(data.ice);
          if (peerConnection && peerConnection.remoteDescription) {
              peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
                  .then(() => console.log('Added ICE candidate successfully'))
                  .catch(error => console.error('Error adding ICE candidate:', error));
          } else {
              if (!iceCandidateBuffer[callId]) {
                  iceCandidateBuffer[callId] = [];
              }
              iceCandidateBuffer[callId].push(candidate);
              console.log('Buffered ICE candidate for call:', callId);
          }
      } catch (error) {
          console.error('Error parsing ICE candidate:', error);
      }
  }
}


function addBufferedIceCandidates() {
  if (webrtcHandler.peerConnection.remoteDescription) {
    iceCandidateBuffer.forEach(candidate => {
      webrtcHandler.peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
        .then(() => console.log('Added buffered ICE candidate successfully'))
        .catch(error => console.error('Error adding buffered ICE candidate:', error));
    });
    iceCandidateBuffer = [];
  }
}

function addBufferedCandidates(callId) {
  console.log('Adding buffered candidates for call:', callId);
  if (iceCandidates[callId]) {
      iceCandidates[callId].forEach((candidate, index) => {
          console.log(`Adding buffered ICE candidate ${index + 1}/${iceCandidates[callId].length}`);
          peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
              .then(() => console.log(`Added buffered ICE candidate ${index + 1} successfully`))
              .catch(error => console.error(`Error adding buffered ICE candidate ${index + 1}:`, error));
      });
      delete iceCandidates[callId];
  } else {
      console.log('No buffered candidates for call:', callId);
  }
}

// Initialize WebRTC handler
function initializeWebRTC() {
  webrtcHandler = new WebRTCHandler(
      (candidate) => {
          if (currentCall) {
              sendIceCandidate(currentCall.id, candidate);
          }
      },
      (event) => {
          console.log('Received remote track:', event.track.kind);
          remoteAudio.srcObject = event.streams[0];
      }
  );
}


// Update your startVoiceCall function
async function startVoiceCall() {
  if (isCallInProgress) {
      alert('A call is already in progress.');
      return;
  }

  const callTo = callToInput.value.trim();
  if (!callTo) {
      alert('Please enter a username to call');
      return;
  }

  try {
      isCallInProgress = true;
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('Local stream obtained:', localStream);
      logAudioTracks(localStream, 'Local stream');
      monitorAudioLevels(localStream, 'Local');
      peerConnection = await webrtcHandler.createPeerConnection();
      const offer = await webrtcHandler.startCall(localStream);
      currentCall = {
          id: Date.now().toString(),
          to: callTo,
          from: user.is.alias,
          startTime: Date.now()
      };

      const offerData = {
          type: 'offer',
          callId: currentCall.id,
          from: user.is.alias,
          to: callTo,
          offerType: offer.type,
          offerSdp: offer.sdp,
          startTime: Date.now()
      };

      console.log('Sending offer:', offerData);
      gun.get(`calls`).get(currentCall.id).put(offerData);

  } catch (error) {
      console.error('Error starting voice call:', error);
      alert('Error starting voice call: ' + error.message);
      isCallInProgress = false;
      if (localStream) {
          localStream.getTracks().forEach(track => track.stop());
      }
  }
}

function handleIncomingIceCandidate(callId, data) {
  if (data && data.ice) {
      try {
          const candidate = JSON.parse(data.ice);
          if (!iceCandidates[callId]) {
              iceCandidates[callId] = [];
          }
          iceCandidates[callId].push(candidate);
          console.log('Buffered ICE candidate for call:', callId);

          if (peerConnection && peerConnection.remoteDescription) {
              addBufferedCandidates(callId);
          }
      } catch (error) {
          console.error('Error parsing ICE candidate:', error);
      }
  }
}

// Modify the handleIncomingCall function
async function handleIncomingCall(data) {
  console.log('Handling incoming call:', data);
  if (isCallInProgress || isIncomingCallHandled) {
      console.log('Already in a call or handling a call, ignoring incoming call');
      return;
  }

  isIncomingCallHandled = true;

  const confirmed = confirm(`Incoming call from ${data.from}. Accept?`);
  if (confirmed) {
      try {
          isCallInProgress = true;
          localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          console.log('Local stream obtained:', localStream);
          logAudioTracks(localStream, 'Local stream');
          monitorAudioLevels(localStream, 'Local');
          
          peerConnection = await webrtcHandler.createPeerConnection();
          localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
          
          const offer = {
              type: data.offerType,
              sdp: data.offerSdp
          };

          console.log('Setting remote description:', offer);
          await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
          
          console.log('Creating answer');
          const answer = await peerConnection.createAnswer();
          
          console.log('Setting local description:', answer);
          await peerConnection.setLocalDescription(answer);

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
              time: Date.now()
          };

          console.log('Sending answer:', answerData);
          gun.get(`calls`).get(data.callId).put(answerData);

          callToInput.value = data.from;
          
          console.log('Adding buffered candidates');
          addBufferedCandidates(data.callId);
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

  isIncomingCallHandled = false;
}

// Update your endVoiceCall function
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
}

async function register() {
  const username = usernameInput.value;
  const password = passwordInput.value;
  
  if (!username || !password) {
    alert('Please enter both username and password');
    return;
  }
  
  if (!isPasswordValid(password)) {
    alert('Password must be at least 12 characters long and contain at least one lowercase letter, one uppercase letter, one number, and one special character.');
    return;
  }
  
  user = gun.user();
  user.create(username, password, (ack) => {
    if (ack.err) {
      alert(ack.err);
    } else {
      alert('Registration successful. You can now log in.');
    }
  });
}

// Login Function
function login() {
  const username = usernameInput.value;
  const password = passwordInput.value;
  
  user = gun.user();
  user.auth(username, password, (ack) => {
    if (ack.err) {
      alert(ack.err);
    } else {
      authDiv.classList.add('hidden');
      chatDiv.classList.remove('hidden');
      loadMessages();
    }
  });
}

// Password Validation
function isPasswordValid(password) {
  const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]).{12,}$/;
  return regex.test(password);
}

// Load Messages
function loadMessages() {
  gun.get(currentRoom).map().on((message, id) => {
    if (message && !messagesDiv.querySelector(`[data-id="${id}"]`)) {
      const messageElement = document.createElement('div');
      messageElement.textContent = `${message.sender}: ${message.content}`;
      messageElement.dataset.id = id;
      messagesDiv.appendChild(messageElement);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
  });
}

// Send Message
function sendMessage() {
  const content = messageInput.value.trim();
  if (content) {
    gun.get(currentRoom).set({
      sender: user.is.alias,
      content: content,
      timestamp: Date.now()
    });
    messageInput.value = '';
  }
}

// Event Listeners
registerBtn.addEventListener('click', register);
loginBtn.addEventListener('click', login);
sendMessageBtn.addEventListener('click', sendMessage);
startVoiceBtn.addEventListener('click', startVoiceCall);
endVoiceBtn.addEventListener('click', endVoiceCall);

// Initialize WebRTC when the page loads
window.addEventListener('load', initializeWebRTC);

// Listen for incoming calls and ICE candidates
gun.on('auth', () => {
  console.log('User authenticated:', user.is.alias);
  gun.get(`calls`).map().on(async (data, key) => {
      if (!data || !data.to || data.to !== user.is.alias) return;
      
      console.log('Received call data:', data);
      
      // Ignore old call data
      if (data.startTime && Date.now() - data.startTime > 60000) return;
      
      if (data.type === 'ice') {
          handleIncomingIceCandidate(key, data);
          
          // Check if we can reconstruct the offer from the ICE candidate
          if (!pendingOffer && data.offerSdp) {
              pendingOffer = {
                  type: 'offer',
                  sdp: data.offerSdp
              };
              console.log('Reconstructed offer from ICE candidate, attempting to show incoming call popup');
              handleIncomingCall({...data, callId: key, offerType: 'offer'});
          }
      } else if (data.type === 'answer' && peerConnection) {
          try {
              await peerConnection.setRemoteDescription(new RTCSessionDescription({
                  type: data.answerType,
                  sdp: data.answerSdp
              }));
              addBufferedCandidates(key);
          } catch (error) {
              console.error('Error setting remote description:', error);
          }
      } else if (data.type === 'end') {
          endVoiceCall();
      } else {
          console.log('Unhandled call data type:', data.type);
      }
  });
});

function addDetailedLogging(peerConnection) {
  peerConnection.oniceconnectionstatechange = () => {
    console.log('ICE connection state changed:', peerConnection.iceConnectionState);
    if (peerConnection.iceConnectionState === 'failed') {
      console.error('ICE connection failed. Attempting to restart ICE...');
      peerConnection.restartIce();
    }
  };

  peerConnection.onicegatheringstatechange = () => {
    console.log('ICE gathering state changed:', peerConnection.iceGatheringState);
  };

  peerConnection.onsignalingstatechange = () => {
    console.log('Signaling state changed:', peerConnection.signalingState);
  };

  peerConnection.onconnectionstatechange = () => {
    console.log('Connection state changed:', peerConnection.connectionState);
    if (peerConnection.connectionState === 'failed') {
      console.error('Connection failed. You might want to create a new peerConnection.');
    }
  };
}




function logAudioTracks(stream, description) {
  const audioTracks = stream.getAudioTracks();
  console.log(`${description} - Audio tracks:`, audioTracks.length);
  audioTracks.forEach((track, index) => {
      console.log(`Track ${index}: enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
  });
}

function monitorAudioLevels(stream, label) {
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