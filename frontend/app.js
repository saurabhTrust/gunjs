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
const processedCandidates = new Set();
let signalingState = 'stable';
let processingCall = false;
let callProcessingTimeout = null;
let processingSignaling = false;

let isIncomingCall = false;
let callScreenVisible = false;
let timerInterval;

// DOM Elements
const authDiv = document.getElementById('auth');
const chatDiv = document.getElementById('chat');
const loginBtn = document.getElementById('login');
const registerBtn = document.getElementById('register');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
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
const startVideoCallBtn = document.getElementById("startVideoCall");
const endCallBtn = document.getElementById('endCall');

const messagesDiv = document.getElementById('messages');
const messageInput = document.querySelector('.message-input');
const sendMessageBtn = document.querySelector('.fa-paper-plane').parentElement;
const contactsList = document.getElementById('contactsList');
const streamsList = document.getElementById('streamsList');
const chatScreen = document.getElementById('chatScreen');
const mainScreen = document.querySelector('.main-screen');


// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  initializeWebRTC();
  if (user && user.is) {
      initializeApp();
  }
});


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
  contactsList.innerHTML = '';
  user.get('contacts').map().on((contactData, contactId) => {
      if (contactData && contactData.alias) {
          const contactElement = createContactElement(contactData.alias);
          if (!contactsList.querySelector(`[data-id="${contactId}"]`)) {
              contactsList.appendChild(contactElement);
          }
      }
  });
}

function createContactElement(alias) {
  const contactElement = document.createElement('div');
  contactElement.className = 'contact-item';
  contactElement.dataset.id = alias;
  contactElement.innerHTML = `
      <div class="avatar">${getInitials(alias)}</div>
      <div class="contact-info">
          <div class="contact-name">${alias}</div>
          <div class="contact-status">Available</div>
      </div>
  `;
  contactElement.addEventListener('click', () => openChat(alias));
  return contactElement;
}


function loadStreams() {
  const streamsGrid = document.querySelector('.streams-grid');
  if (!streamsGrid) return;
  
  streamsGrid.innerHTML = '';
  
  user.get('groups').map().on((groupId) => {
    if (!groupId) return;

    gun.get('groups').get(groupId).once(async (groupData) => {
      if (!groupData) return;

      // Check if user is still a member
      const { members, memberCount } = await getMembersInfo(groupData);
      if (members.indexOf(user.is.alias) >  -1) {
        const streamElement = await createStreamElement(groupId, groupData);
        if (streamElement && !streamsGrid.querySelector(`[data-id="${groupId}"]`)) {
          streamsGrid.appendChild(streamElement);
        }
      }
    });
  });
}


async function createStream() {
  const input = document.querySelector('#addStreamDialog .dialog-input');
  const streamName = input.value.trim();
  
  if (streamName) {
      const groupId = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const groupData = {
          name: streamName,
          creator: user.is.alias,
          members: {[user.is.alias]: true},
          createdAt: Date.now()
      };
      
      gun.get('groups').get(groupId).put(groupData, (ack) => {
          if (!ack.err) {
              user.get('groups').set(groupId);
              input.value = '';
              closeDialog('addStreamDialog');
              showStatus('Success', 'Stream created successfully!');
              loadStreams();
          } else {
              showStatus('Error', 'Failed to create stream.');
          }
      });
  }
}


function getInitials(name) {
  if (!name) return '?'; // Return fallback for undefined/null names
  
  return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase() || '?';
}


function getChatId(user1, user2) {
  return [user1, user2].sort().join('_');
}

function getMembersInfo(groupData) {
  return new Promise(resolve => {
    const members = [];
    let memberCount = 0;
    
    const groupId = groupData._ && groupData._['#'];
    if (!groupId) {
      resolve({ members, memberCount });
      return;
    }

    gun.get('groups').get(groupId.split('/')[1]).get('members').map().once((value, key) => {
      if (value === true) {
        members.push(key);
        memberCount++;
      }
    });

    setTimeout(() => resolve({ members, memberCount }), 100);
  });
}

async function createStreamElement(groupId, groupData) {
  if (!groupData || !groupData.name) return null;

  try {
    const { members, memberCount } = await getMembersInfo(groupData);
    const streamElement = document.createElement('div');
    streamElement.className = 'stream-item';
    streamElement.dataset.id = groupId;
    
    const name = groupData.name;
    
    streamElement.innerHTML = `
      <div class="avatar">${getInitials(name)}</div>
      <div class="stream-info">
          <div class="name">${name}</div>
          <div class="member-count">${memberCount} member${memberCount !== 1 ? 's' : ''}</div>
      </div>
    `;

    streamElement.addEventListener('click', () => openStreamChat(groupId, name));
    return streamElement;
  } catch (error) {
    console.error('Error creating stream element:', error);
    return null;
  }
}


function openChat(name) {
  currentChat = name;
  currentChatType = 'direct';
  showChatScreen();
  
  const chatTitle = document.getElementById('chatTitle');
  chatTitle.textContent = name;
  
  const headerActions = document.querySelector('.header-actions');
  headerActions.innerHTML = `<div class="call-buttons">
        <button class="action-button" onclick="startCall(false)">
            <i class="fas fa-phone"></i>
        </button>
        <button class="action-button" onclick="startCall(true)">
            <i class="fas fa-video"></i>
        </button>
      </div>
  `;
  
  loadMessages(name);
}

function openStreamChat(groupId, name) {
  currentChat = groupId;
  currentChatType = 'group';
  
  const chatScreen = document.getElementById('chatScreen');
  const mainScreen = document.querySelector('.main-screen');
  
  mainScreen.style.display = 'none';
  chatScreen.classList.add('show');
  
  // Clear messages before loading new ones
  const messagesDiv = document.getElementById('messages');
  messagesDiv.innerHTML = '';
  
  // Get fresh group data
  gun.get('groups').get(groupId).on(async (groupData) => {
      if (!groupData) return;

      const chatTitle = document.getElementById('chatTitle');
      const headerActions = document.querySelector('.header-actions');
      
      // Get accurate member count
      const { members, memberCount } = await getMembersInfo(groupData);
      chatTitle.textContent = `${groupData.name} (${memberCount})`;
      
      // Show manage button only if user is admin
      if (groupData.creator === user.is.alias) {
          headerActions.innerHTML = `
              <button class="action-button" onclick="openStreamManagement()">
                  <i class="fas fa-users"></i>
              </button>
          `;
      } else {
          headerActions.innerHTML = '';
      }
      
      loadGroupMessages(groupId);
  });
}

function updateStreamHeader(streamData) {
  const memberCount = Object.keys(streamData.members || {}).length;
  const chatTitle = document.getElementById('chatTitle');
  chatTitle.textContent = `${streamData.name} (${memberCount} members)`;
}


async function removeMember(memberId) {
  try {
      const streamData = await new Promise(resolve => {
          gun.get('groups').get(currentChat).once(data => resolve(data));
      });

      if (!streamData || streamData.creator !== user.is.alias) {
          await showCustomAlert('Only the stream admin can remove members');
          return;
      }

      const confirmed = await showCustomConfirm(`Remove ${memberId} from the stream?`);
      if (!confirmed) return;

      // Remove member from group
      await new Promise(resolve => {
          gun.get('groups').get(currentChat).get('members').get(memberId).put(null, resolve);
      });

      // Remove group from user's groups list
      await new Promise(resolve => {
          gun.get('users').get(memberId).get('groups').set({
              [currentChat]: null
          }, resolve);
      });

      // Force update the streams list for the removed user
      gun.get('users').get(memberId).get('groups').once(() => {
          loadStreams();
      });

      await showCustomAlert(`${memberId} has been removed from the stream`);
      openStreamManagement();

  } catch (error) {
      console.error('Error removing member:', error);
      await showCustomAlert('Error removing member. Please try again.');
  }
}

async function addMemberToStream() {
  const input = document.querySelector('#addMemberDialog .dialog-input');
  const username = input.value.trim();
  
  if (!username) return;

  try {
      // Check if user exists
      const userExists = await new Promise(resolve => {
          gun.get('users').get(username).once(userData => {
              resolve(!!userData);
          });
      });

      if (!userExists) {
          await showCustomAlert('User does not exist');
          return;
      }

      // Get stream data to check admin status
      const streamData = await new Promise(resolve => {
          gun.get('groups').get(currentChat).once(data => resolve(data));
      });

      if (!streamData || streamData.creator !== user.is.alias) {
          await showCustomAlert('Only the stream admin can add members');
          return;
      }

      // Check if user is already a member
      if (streamData.members && streamData.members[username]) {
          await showCustomAlert('User is already a member of this stream');
          return;
      }

      // Add member
      gun.get('groups').get(currentChat).get('members').get(username).put(true);

      // Send invitation
      gun.get('users').get(username).get('groupInvitations').set({
          groupId: currentChat,
          from: user.is.alias,
          groupName: streamData.name,
          timestamp: Date.now()
      });

      // Close dialogs and show confirmation
      closeDialog('addMemberDialog');
      await showCustomAlert(`Invitation sent to ${username}`);
      
      // Refresh member list
      openStreamManagement();

  } catch (error) {
      console.error('Error adding member:', error);
      await showCustomAlert('Error adding member. Please try again.');
  }
}

function openStreamManagement() {
  const streamManagementDialog = document.getElementById('streamManagementDialog');
  const membersList = document.getElementById('streamMembersList');
  membersList.innerHTML = ''; 
  
  gun.get('groups').get(currentChat).on(async (streamData) => {
    console.log('streamData.creator', streamData.creator);
      if (!streamData || !streamData.members) return;
      
      const isAdmin = streamData.creator === user.is.alias;

      const { members, memberCount } = await getMembersInfo(streamData);
      membersList.innerHTML = '';
      members.forEach((memberId) => {
          const memberItem = document.createElement('div');
          memberItem.className = 'member-item';
          memberItem.innerHTML = `
              <div class="member-avatar">${getInitials(memberId)}</div>
              <div class="member-info">
                  <span class="member-name">${memberId}</span>
                  ${memberId === streamData.creator ? 
                      '<span class="admin-badge">Admin</span>' : ''}
              </div>
              ${isAdmin && memberId !== user.is.alias ? `
                  <button class="remove-member" onclick="removeMember('${memberId}')">
                      <i class="fas fa-times"></i>
                  </button>
              ` : ''}
          `;
          
          membersList.appendChild(memberItem);
      });

      const addMemberIcon = document.querySelector('.add-member-icon');
      if (addMemberIcon) {
          addMemberIcon.style.display = isAdmin ? 'flex' : 'none';
      }
  });

  openDialog('streamManagementDialog');
}

function showChatScreen() {
  mainScreen.style.display = 'none';
  chatScreen.classList.add('show');
  
  // Ensure header buttons are properly aligned
  const headerActions = document.querySelector('.header-actions');
  if (currentChatType === 'direct') {
      headerActions.innerHTML = `
          <div class="call-buttons">
              <button class="action-button" onclick="startCall(false)">
                  <i class="fas fa-phone"></i>
              </button>
              <button class="action-button" onclick="startCall(true)">
                  <i class="fas fa-video"></i>
              </button>
          </div>
      `;
  }
}


function goBack() {
  mainScreen.style.display = 'block';
  chatScreen.classList.remove('show');
  clearChat();
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

      const messageData = {
          sender: user.is.alias,
          content: content,
          timestamp: Date.now()
      };

      if (currentChatType === 'direct') {
          gun.get(`chats`).get(getChatId(user.is.alias, currentChat)).set(messageData);
      } else if (currentChatType === 'group') {
          gun.get(`groupChats`).get(currentChat).set(messageData);
      }
      
      messageInput.value = '';
  }
}


function listenForContactRequests() {
  console.log("I am running");
  user.get('contactRequests').map().on(async (request, requestId) => {
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

sendMessageBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
      sendMessage();
  }
});


function initializeApp() {
  if (user && user.is) {
      loadContacts();
      loadStreams();
      setupContactRequestListener();
      setupContactAcceptanceListener();
      setupGroupInvitationListener();
      setupTypingNotification();
      setupSearch();
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
  try {
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
          // If rejected, remove the request
          gun.get('users').get(user.is.alias).get('contactRequests').get(requestId).put(null, (ack) => {
              console.log("Removed rejected contact request:", ack);
          });
      }
  } catch (error) {
      console.error("Error handling contact request:", error);
      await showCustomAlert("Error processing contact request. Please try again.");
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
  const groupName = document.querySelector('#addStreamDialog .dialog-input').value.trim();
  if (!groupName) return;

  const groupId = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const groupData = {
      name: groupName,
      creator: user.is.alias,
      members: {},
      createdAt: Date.now()
  };
  
  // Add creator as first member
  groupData.members[user.is.alias] = true;

  gun.get('groups').get(groupId).put(groupData, async (ack) => {
      if (ack.err) {
          await showCustomAlert('Error creating stream: ' + ack.err);
          return;
      }

      // Add group to creator's groups
      user.get('groups').set(groupId);
      
      closeDialog('addStreamDialog');
      document.querySelector('#addStreamDialog .dialog-input').value = '';
      
      await showCustomAlert('Stream created successfully!');
      loadGroups(); // Refresh streams list
  });
}

function loadGroups() {
  const streamsGrid = document.querySelector('.streams-grid');
  if (!streamsGrid) {
      console.error('Streams grid element not found');
      return;
  }
  
  streamsGrid.innerHTML = '';
  
  user.get('groups').map().on((groupId) => {
      if (!groupId) return;

      gun.get('groups').get(groupId).once((groupData) => {
          try {
              if (groupData && !streamsGrid.querySelector(`[data-id="${groupId}"]`)) {
                  const streamElement = createStreamElement(groupId, groupData);
                  if (streamElement) {
                      streamsGrid.appendChild(streamElement);
                  }
              }
          } catch (error) {
              console.error('Error creating stream element:', error);
          }
      });
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
          const accepted = await showCustomConfirm(
              `${invitation.from} invited you to join the stream "${invitation.groupName}". Accept?`
          );
          
          if (accepted) {
              user.get('groups').set(invitation.groupId);
              gun.get('groups').get(invitation.groupId).get('members').get(user.is.alias).put(true);
              
              // Remove the invitation after accepting
              gun.get('users').get(user.is.alias).get('groupInvitations').get(invitationId).put(null);
              
              // Refresh streams grid
              loadGroups();
              await showCustomAlert(`You've been added to ${invitation.groupName}`);
          } else {
              // Remove the invitation if rejected
              gun.get('users').get(user.is.alias).get('groupInvitations').get(invitationId).put(null);
          }
      }
  });
}

async function endCall() {
  if (currentCall) {
      await new Promise((resolve) => {
          gun.get('calls').get(currentCall.id).put({
              type: 'end',
              from: user.is.alias,
              to: currentCall.to,
              endTime: Date.now(),
              status: 'ended'
          }, resolve);
      });
  }

  // Stop timer
  if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
  }

  // Clean up media streams
  if (localStream) {
      localStream.getTracks().forEach(track => {
          track.stop();
      });
      localStream = null;
  }

  // Close peer connection
  if (peerConnection) {
      try {
          peerConnection.close();
      } catch (error) {
          console.error('Error closing peer connection:', error);
      }
      peerConnection = null;
  }

  // Remove call screen
  const callScreen = document.getElementById('callScreen');
  if (callScreen) {
      callScreen.remove();
      callScreenVisible = false;
  }

  const remoteVideo = document.getElementById('remoteVideo');
  const localVideo = document.getElementById('localVideo');
  if (remoteVideo) remoteVideo.srcObject = null;
  if (localVideo) localVideo.srcObject = null;

  // Reset all states
  currentCall = null;
  isCallInProgress = false;
  isVideoCall = false;
  isIncomingCall = false;
}


// function handleTrack(event) {
//   console.log('Received remote track:', event.track.kind);
  
//   if (event.track.kind === 'audio') {
//       // Create audio element if it doesn't exist
//       let remoteAudio = document.getElementById('remoteAudio');
//       if (!remoteAudio) {
//           remoteAudio = document.createElement('audio');
//           remoteAudio.id = 'remoteAudio';
//           remoteAudio.autoplay = true;
//           document.body.appendChild(remoteAudio);
//       }
//       remoteAudio.srcObject = event.streams[0];
//   } 
  
//   if (event.track.kind === 'video') {
//       const remoteVideo = document.getElementById('remoteVideo');
//       if (remoteVideo) {
//           console.log('Setting remote video stream');
//           remoteVideo.srcObject = event.streams[0];
          
//           // Ensure the video is visible
//           const videoContainer = document.querySelector('.video-content');
//           if (videoContainer) {
//               videoContainer.style.display = 'block';
//           }

//           // Log video track status
//           event.track.onmute = () => console.log('Remote video track muted');
//           event.track.onunmute = () => console.log('Remote video track unmuted');
//           event.track.onended = () => console.log('Remote video track ended');

//           // Monitor video element status
//           remoteVideo.onloadedmetadata = () => console.log('Remote video metadata loaded');
//           remoteVideo.onplay = () => console.log('Remote video playing');
//           remoteVideo.onpause = () => console.log('Remote video paused');
//           remoteVideo.onerror = (e) => console.error('Remote video error:', e);
//       } else {
//           console.error('Remote video element not found');
//       }
//   }
// }

function handleTrack(event) {
  console.log('Received remote track:', event.track.kind);
  
  if (event.track.kind === 'audio') {
      let remoteAudio = document.getElementById('remoteAudio');
      if (!remoteAudio) {
          remoteAudio = document.createElement('audio');
          remoteAudio.id = 'remoteAudio';
          remoteAudio.autoplay = true;
          document.body.appendChild(remoteAudio);
      }
      remoteAudio.srcObject = event.streams[0];
  } 
  
  if (event.track.kind === 'video') {
      const remoteVideo = document.getElementById('remoteVideo');
      if (remoteVideo) {
          console.log('Setting remote video stream');
          remoteVideo.srcObject = event.streams[0];
          
          // Log video track status for debugging
          event.track.onmute = () => console.log('Remote video track muted');
          event.track.onunmute = () => console.log('Remote video track unmuted');
          event.track.onended = () => console.log('Remote video track ended');
      }
  }
}


async function rejectCall(data, reason) {
  if (data && data.callId) {
      await new Promise((resolve) => {
          gun.get('calls').get(data.callId).put({
              type: 'end',
              from: user.is.alias,
              to: data.from,
              endTime: Date.now(),
              status: 'rejected',
              reason: reason
          }, resolve);
      });
  }
}

function initializeWebRTC() {
  webrtcHandler = new WebRTCHandler(
    handleICECandidate,
    handleTrack
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
  gun.get(`calls`).map().on(async (data, key) => {
      if (!data || !data.to || data.to !== user.is.alias) return;
      
      try {
          if (data.type === 'end') {
              endCall();
          } else if (data.type === 'ice' && peerConnection) {
              handleIncomingIceCandidate(key, data);
          } else if (data.type === 'offer' && !isCallInProgress && !isIncomingCall) {
              handleIncomingCall(data);
          } else if (data.type === 'answer' && peerConnection && !processingSignaling) {
              processingSignaling = true;
              try {
                  if (peerConnection.signalingState === 'have-local-offer') {
                      await peerConnection.setRemoteDescription(new RTCSessionDescription({
                          type: data.answerType,
                          sdp: data.answerSdp
                      }));
                      //startTimer();
                  }
              } catch (error) {
                  console.error('Error setting remote description:', error);
              } finally {
                  processingSignaling = false;
              }
          }
      } catch (error) {
          console.error('Error processing call event:', error);
          processingSignaling = false;
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
  gun.get('calls').get(callId).get('iceCandidates').map().on((stringifiedCandidate, key) => {
    if (!stringifiedCandidate || processedCandidates.has(key)) return;
    processedCandidates.add(key);

    try {
      const iceCandidate = JSON.parse(stringifiedCandidate);
      if (iceCandidate && iceCandidate.from !== user.is.alias) {
        webrtcHandler.addIceCandidate(iceCandidate.candidate)
          .catch(error => console.error('Error adding ICE candidate:', error));
      }
    } catch (error) {
      console.error('Error parsing ICE candidate:', error);
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

// async function showExpiryDialog() {
//   const dialogHtml = `
//     <div class="dialog-content">
//       <p>Set file expiration time (in minutes)</p>
//       <p>Enter 0 for no expiration</p>
//       <input type="number" min="0" id="expiryInput" class="input-box-style" value="0">
//       <div class="dialog-buttons">
//         <button class="primary-button-style" id="confirmExpiry">Confirm</button>
//         <button class="primary-button-style" id="cancelExpiry">Cancel</button>
//       </div>
//     </div>
//   `;

//   const dialog = document.createElement('div');
//   dialog.className = 'custom-dialog';
//   dialog.innerHTML = dialogHtml;
//   document.body.appendChild(dialog);

//   return new Promise((resolve) => {
//     document.getElementById('confirmExpiry').onclick = () => {
//       const minutes = parseInt(document.getElementById('expiryInput').value) || 0;
//       document.body.removeChild(dialog);
//       resolve(minutes);
//     };
//     document.getElementById('cancelExpiry').onclick = () => {
//       document.body.removeChild(dialog);
//       resolve(null);
//     };
//   });
// }

function showExpiryDialog() {
  return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'expiry-overlay';

      const dialog = document.createElement('div');
      dialog.className = 'expiry-dialog';
      dialog.innerHTML = `
          <h3>Set File Expiry Time</h3>
          <div class="expiry-hint">Set how long the file will be available</div>
          <input type="number" min="0" 
                 class="expiry-input" 
                 placeholder="Enter minutes (0 for no expiry)"
                 id="expiryInput">
          <div class="expiry-buttons">
              <button class="expiry-button cancel" id="cancelExpiry">Cancel</button>
              <button class="expiry-button confirm" id="confirmExpiry">Confirm</button>
          </div>
      `;

      document.body.appendChild(overlay);
      document.body.appendChild(dialog);

      const input = dialog.querySelector('#expiryInput');
      input.focus();

      function cleanup() {
          document.body.removeChild(overlay);
          document.body.removeChild(dialog);
      }

      dialog.querySelector('#confirmExpiry').onclick = () => {
          const minutes = parseInt(input.value) || 0;
          cleanup();
          resolve(minutes);
      };

      dialog.querySelector('#cancelExpiry').onclick = () => {
          cleanup();
          resolve(null);
      };

      input.onkeypress = (e) => {
          if (e.key === 'Enter') {
              const minutes = parseInt(input.value) || 0;
              cleanup();
              resolve(minutes);
          }
      };

      overlay.onclick = (e) => {
          if (e.target === overlay) {
              cleanup();
              resolve(null);
          }
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
      const expiryMinutes = await showExpiryDialog();
      if (expiryMinutes === null) {
          fileInput.value = '';
          return;
      }

      // Calculate expiry timestamp
      const expiryTime = expiryMinutes === 0 ? 
          Number.MAX_SAFE_INTEGER : 
          Date.now() + (expiryMinutes * 60 * 1000);

      // Create temporary preview message
      const tempMessage = document.createElement('div');
      tempMessage.className = 'message file-preview sent';
      tempMessage.innerHTML = `
          <div>Sending ${file.name}...</div>
          <div class="loading-spinner"></div>
      `;
      messagesDiv.appendChild(tempMessage);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;

      // Display preview
      await displayFilePreview(file, fileType, false, tempMessage);
      
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

      // Remove temporary message
      tempMessage.remove();
      
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


function loadMessages(contactAlias) {
  const chatId = getChatId(user.is.alias, contactAlias);
  gun.get(`chats`).get(chatId).map().on((message, id) => {
      displayMessage(message, id);
  });
}



function loadGroupMessages(groupId) {
  const messagesDiv = document.getElementById('messages');
  
  gun.get(`groupChats`).get(groupId).map().once((message, id) => {
      if (!message || messagesDiv.querySelector(`[data-id="${id}"]`)) return;

      displayMessage(message, id);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
  });
}

function displayMessage(message, id) {
  if (!message || messagesDiv.querySelector(`[data-id="${id}"]`)) return;

  const messageElement = document.createElement('div');
  messageElement.dataset.id = id;
  messageElement.className = `message ${message.sender === user.is.alias ? 'sent' : 'received'}`;

  if (message.type === 'file') {
      try {
          const fileInfo = JSON.parse(message.content);
          const isExpired = fileInfo.expiryTime && fileInfo.expiryTime < Date.now();
          
          messageElement.innerHTML = `
              <div class="file-message">
                  ${message.sender}: ${isExpired ? 'File has expired' : `Sent a ${fileInfo.fileType}`}
                  <div class="file-info">
                      <i class="fas ${getFileIcon(fileInfo.fileType)}"></i>
                      <span>${fileInfo.fileName}</span>
                  </div>
                  ${!isExpired ? `
                      <div class="file-actions">
                          <button class="file-button" onclick="handleFileDownload('${encodeURIComponent(JSON.stringify(fileInfo))}')">
                              Download
                          </button>
                      </div>
                  ` : ''}
              </div>
          `;
      } catch (err) {
          console.error('Error displaying file message:', err);
          messageElement.textContent = `${message.sender}: Error displaying file`;
      }
  } else {
      messageElement.textContent = `${message.sender}: ${message.content}`;
  }

  messagesDiv.appendChild(messageElement);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function getFileIcon(fileType) {
  switch (fileType) {
      case 'image':
          return 'fa-image';
      case 'video':
          return 'fa-video';
      case 'document':
          return 'fa-file-alt';
      default:
          return 'fa-file';
  }
}

async function handleFileDownload(encodedFileInfo) {
  try {
      const fileInfo = JSON.parse(decodeURIComponent(encodedFileInfo));
      
      // Check expiry
      if (fileInfo.expiryTime && fileInfo.expiryTime < Date.now()) {
          await showCustomAlert('This file has expired and is no longer available.');
          return;
      }

      // Show loading state
      const downloadBtn = event.target;
      const originalText = downloadBtn.textContent;
      downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Downloading...';
      downloadBtn.disabled = true;

      // Get file from IPFS
      const response = await fetch(`${IPFS_BACKEND_URL}/getFile`, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
          },
          body: JSON.stringify({ cid: fileInfo.cid })
      });

      if (!response.ok) {
          throw new Error(`Failed to fetch file: ${response.statusText}`);
      }

      const result = await response.json();
      const fileUrl = result.result;
      const encryptedFileResponse = await fetch(fileUrl);
      
      if (!encryptedFileResponse.ok) {
          throw new Error(`Failed to download file: ${encryptedFileResponse.statusText}`);
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

          // Update progress
          if (totalSize) {
              const progress = Math.round((downloadedSize / totalSize) * 100);
              downloadBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${progress}%`;
          }
      }

      // Combine chunks and decrypt
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

      // Create and download file
      const blob = new Blob([decryptedFile], { type: fileInfo.fileType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileInfo.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Reset button
      downloadBtn.innerHTML = originalText;
      downloadBtn.disabled = false;

  } catch (error) {
      console.error('Error downloading file:', error);
      await showCustomAlert('Error downloading file. Please try again.');
      event.target.innerHTML = originalText;
      event.target.disabled = false;
  }
}

function openDialog(dialogId) {
  document.getElementById(dialogId).classList.add('show');
}

function closeDialog(dialogId) {
  document.getElementById(dialogId).classList.remove('show');
}


function showStatus(title, message) {
  document.getElementById('statusTitle').textContent = title;
  document.getElementById('statusMessage').textContent = message;
  openDialog('statusDialog');
}


async function addContact() {
  const input = document.querySelector('#addContactDialog .dialog-input');
  const newContact = input.value.trim();
  
  if (newContact && newContact !== user.is.alias) {
      gun.get('users').get(newContact).once(async (userData) => {
          if (userData && userData.username) {
              gun.get('users').get(newContact).get('contactRequests').set({
                  from: user.is.alias,
                  timestamp: Date.now()
              });
              input.value = '';
              closeDialog('addContactDialog');
              showStatus('Request Sent', `Contact request sent to ${newContact}`);
          } else {
              showStatus('Error', `User ${newContact} does not exist.`);
          }
      });
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

function ensureTypingContainer() {
    let typingContainer = document.getElementById('typingContainer');
    if (!typingContainer) {
        typingContainer = document.createElement('div');
        typingContainer.id = 'typingContainer';
        typingContainer.className = 'typing-container';
        document.getElementById('messages').appendChild(typingContainer);
    }
}

document.getElementById('sendFile').addEventListener('click', sendFile);

function handleTypingEvent() {
  if (typingTimeout) clearTimeout(typingTimeout);
  
  sendTypingStatus(true);
  
  typingTimeout = setTimeout(() => {
    sendTypingStatus(false);
  }, TYPING_TIMEOUT);
}

function setupTypingNotification() {
  ensureTypingContainer();
  
  messageInput.addEventListener('input', handleTypingEvent);
  messageInput.addEventListener('blur', () => {
      if (typingTimeout) clearTimeout(typingTimeout);
      sendTypingStatus(false);
  });
  listenForTypingNotifications();
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
      gun.get('streamTyping').get(currentChat).get(user.is.alias).put(typingData);
  }
}

function listenForTypingNotifications() {
  // For direct chats
  gun.get('typing').map().on((data, chatId) => {
      if (!data || !data.user || data.user === user.is.alias) return;

      if (currentChatType === 'direct' && 
          chatId === getChatId(user.is.alias, currentChat)) {
          updateTypingIndicator(data.user, data.isTyping);
      }
  });

  // For streams
  gun.get('streamTyping').map().on((streamData, streamId) => {
      if (currentChatType === 'group' && streamId === currentChat) {
          gun.get('streamTyping').get(streamId).map().on((data) => {
              if (!data || !data.user || data.user === user.is.alias) return;
              updateTypingIndicator(data.user, data.isTyping);
          });
      }
  });
}

function updateTypingIndicator(username, isTyping) {
  const typingContainer = document.getElementById('typingContainer');
  if (!typingContainer) return;

  const typingIndicatorId = `typing-${username}`;
  let typingIndicator = document.getElementById(typingIndicatorId);

  if (isTyping) {
      if (!typingIndicator) {
          typingIndicator = document.createElement('div');
          typingIndicator.id = typingIndicatorId;
          typingIndicator.className = 'typing-indicator';
          
          typingIndicator.innerHTML = `
              <span class="typing-text">${username} is typing</span>
              <div class="typing-dots">
                  <span class="dot"></span>
                  <span class="dot"></span>
                  <span class="dot"></span>
              </div>
          `;
          
          typingContainer.appendChild(typingIndicator);
          
          // Only scroll if user is near bottom
          const messages = document.getElementById('messages');
          const isNearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 100;
          if (isNearBottom) {
              messages.scrollTop = messages.scrollHeight;
          }
      }
  } else if (typingIndicator) {
      typingIndicator.remove();
  }
}


function clearChat() {
  if (typingTimeout) {
      clearTimeout(typingTimeout);
  }
  sendTypingStatus(false);
  
  const typingContainer = document.getElementById('typingContainer');
  if (typingContainer) {
      typingContainer.innerHTML = '';
  }
  
  messageInput.value = '';
  messagesDiv.innerHTML = '';
  ensureTypingContainer();
  
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


function createCallScreen(isVideo = false) {
  const callScreen = document.createElement('div');
  callScreen.id = 'callScreen';
  callScreen.className = 'chat-screen call-screen';
  
  callScreen.innerHTML = `
      ${isVideo ? `
          <div class="video-content">
              <video id="remoteVideo" autoplay playsinline style="width: 100%; height: 100%; object-fit: cover;"></video>
              <video id="localVideo" autoplay muted playsinline style="position: absolute; bottom: 24px; right: 24px; width: 120px; height: 160px; border-radius: 12px; object-fit: cover;"></video>
              <div class="timer">00:00</div>
          </div>
      ` : `
          <div class="voice-content">
              <div class="avatar">
                  ${getInitials(currentChat)}
              </div>
              <div class="caller-name">${currentChat}</div>
              <div class="timer">00:00</div>
          </div>
      `}
      
      <div class="call-controls">
          <button class="action-button" onclick="toggleMute()" id="muteButton">
              <i class="fas fa-microphone"></i>
          </button>
          ${isVideo ? `
              <button class="action-button" onclick="toggleVideo()" id="videoButton">
                  <i class="fas fa-video"></i>
              </button>
          ` : ''}
          <button class="action-button end-call" onclick="endCall()">
              <i class="fas fa-phone-slash"></i>
          </button>
      </div>
  `;

  // Remove existing call screen if any
  const existingCallScreen = document.getElementById('callScreen');
  if (existingCallScreen) {
      existingCallScreen.remove();
  }

  const style = document.createElement('style');
  style.textContent = `
      .call-screen {
          background: #000 !important;
          height: 100vh;
          display: flex;
          flex-direction: column;
      }

      .video-content {
          flex: 1;
          position: relative;
          background: #000;
          display: flex;
          align-items: center;
          justify-content: center;
      }

      #remoteVideo {
          width: 100%;
          height: 100%;
          object-fit: cover;
          background: #000;
      }

      #localVideo {
          position: absolute;
          bottom: 24px;
          right: 24px;
          width: 120px;
          height: 160px;
          border-radius: 12px;
          object-fit: cover;
          background: #000;
          z-index: 2;
      }

      .call-controls {
          padding: 20px;
          display: flex;
          justify-content: center;
          gap: 20px;
          background: transparent;
          position: relative;
          z-index: 3;
      }

      .chat-header {
          background: transparent;
          z-index: 3;
      }
  `;
  document.head.appendChild(style);

  document.getElementById('app').appendChild(callScreen);
  callScreen.classList.add('show');
  return callScreen;
}




function startTimer() {
    let seconds = 0;
    const timerElement = document.querySelector('.timer');
    
    timerInterval = setInterval(() => {
        seconds++;
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        timerElement.textContent = `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
    }, 1000);
}


function updateCallingStatus(status) {
  const chatTitle = document.querySelector('#callScreen .chat-title');
  if (chatTitle) {
      chatTitle.textContent = status;
  }
}

function onCallConnected() {
  //updateCallingStatus('Connected');
  startTimer();
}


// async function startCall(withVideo = false) {
//   if (isCallInProgress || currentChatType !== 'direct') {
//       await showCustomAlert('A call is already in progress or you\'re not in a direct chat.');
//       return;
//   }

//   try {
//       isCallInProgress = true;
//       isVideoCall = withVideo;
      
//       // Get media stream with explicit video constraints
//       const mediaConstraints = { 
//           audio: true, 
//           video: withVideo ? {
//               width: { ideal: 1280 },
//               height: { ideal: 720 }
//           } : false 
//       };
      
//       localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
//       console.log('Local stream tracks:', localStream.getTracks());

//       // Create call screen first
//       createCallScreen(withVideo);
      
//       if (withVideo) {
//           const localVideo = document.getElementById('localVideo');
//           if (localVideo) {
//               localVideo.srcObject = localStream;
//           }
//       }

//       // Create peer connection and add tracks
//       peerConnection = await webrtcHandler.createPeerConnection();

//             // Add tracks to peer connection
//             localStream.getTracks().forEach(track => {
//               peerConnection.addTrack(track, localStream);
//           });
          
//           // Create and set local description
//           const offer = await peerConnection.createOffer({
//               offerToReceiveAudio: true,
//               offerToReceiveVideo: withVideo
//           });
//           await peerConnection.setLocalDescription(offer);
          
//           const callId = Date.now().toString();
//           currentCall = {
//               id: callId,
//               to: currentChat,
//               from: user.is.alias,
//               startTime: Date.now(),
//               isVideo: withVideo
//           };
    
//           // Send call data
//           const callData = {
//               type: 'offer',
//               callId: callId,
//               from: user.is.alias,
//               to: currentChat,
//               offerType: offer.type,
//               offerSdp: offer.sdp,
//               startTime: currentCall.startTime,
//               isVideo: withVideo,
//               status: 'connecting'
//           };
    
//           await new Promise((resolve, reject) => {
//               gun.get('calls').get(callId).put(callData, (ack) => {
//                   if (ack.err) reject(new Error(ack.err));
//                   else resolve();
//               });
//           });
      
//   } catch (error) {
//       console.error('Error in startCall:', error);
//       await showCustomAlert('Error starting call: ' + error.message);
//       await endCall();
//   }
// }

async function startCall(withVideo = false) {
  if (isCallInProgress || currentChatType !== 'direct') {
      await showCustomAlert('A call is already in progress or you\'re not in a direct chat.');
      return;
  }

  try {
      isCallInProgress = true;
      isVideoCall = withVideo;
      
      // Get media stream with explicit video constraints
      const mediaConstraints = { 
          audio: true, 
          video: withVideo ? {
              width: { ideal: 1280 },
              height: { ideal: 720 }
          } : false 
      };
      
      localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
      console.log('Local stream tracks:', localStream.getTracks());

      // Create call screen first
      createCallScreen(withVideo);
      
      if (withVideo) {
          const localVideo = document.getElementById('localVideo');
          if (localVideo) {
              localVideo.srcObject = localStream;
          }
      }

      // Create peer connection and add tracks
      peerConnection = await webrtcHandler.createPeerConnection();
      
      // Add all tracks to peer connection
      localStream.getTracks().forEach(track => {
          console.log('Adding track to peer connection:', track.kind);
          peerConnection.addTrack(track, localStream);
      });

      // Create and set local description
      const offer = await peerConnection.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: withVideo
      });
      await peerConnection.setLocalDescription(offer);

      const callId = Date.now().toString();
      currentCall = {
          id: callId,
          to: currentChat,
          from: user.is.alias,
          startTime: Date.now(),
          isVideo: withVideo
      };

      // Send call data
      await new Promise((resolve, reject) => {
          gun.get('calls').get(callId).put({
              type: 'offer',
              callId: callId,
              from: user.is.alias,
              to: currentChat,
              offerType: offer.type,
              offerSdp: offer.sdp,
              startTime: currentCall.startTime,
              isVideo: withVideo,
              status: 'connecting'
          }, (ack) => {
              if (ack.err) reject(new Error(ack.err));
              else resolve();
          });
      });

  } catch (error) {
      console.error('Error in startCall:', error);
      await showCustomAlert('Error starting call: ' + error.message);
      await endCall();
  }
}

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

// async function handleIncomingCall(data) {
//   if (isCallInProgress) {
//       console.log('Already in a call, ignoring incoming call');
//       return;
//   }
  
//   const callType = data.isVideo ? 'video' : 'voice';
//   const confirmed = confirm(`Incoming ${callType} call from ${data.from}. Accept?`);
  
//   if (confirmed) {
//       try {
//           isCallInProgress = true;
//           isVideoCall = data.isVideo;
//           const mediaConstraints = { audio: true, video: data.isVideo };
//           localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
//           console.log('Local stream obtained:', localStream.getTracks());
          
//           // Create and show call screen
//           createCallScreen(data.isVideo);
//           //updateCallingStatus('Incomming...');
//           // Update video elements if it's a video call
//           if (data.isVideo) {
//               const localVideo = document.getElementById('localVideo');
//               if (localVideo) {
//                   localVideo.srcObject = localStream;
//               }
//               //document.getElementById('videoContainer').classList.remove('hidden');
//           }
          
//           peerConnection = await webrtcHandler.createPeerConnection();
          
//           const offer = {
//               type: data.offerType,
//               sdp: data.offerSdp
//           };
//           const answer = await webrtcHandler.handleIncomingCall(offer, localStream);
          
//           currentCall = {
//               id: data.callId,
//               to: data.from,
//               from: user.is.alias,
//               startTime: Date.now(),
//               isVideo: data.isVideo
//           };
          
//           const answerData = {
//               type: 'answer',
//               callId: data.callId,
//               from: user.is.alias,
//               to: data.from,
//               answerType: answer.type,
//               answerSdp: answer.sdp,
//               time: currentCall.startTime,
//               isVideo: data.isVideo
//           };
          
//           gun.get(`calls`).get(data.callId).put(answerData);
//           console.log('Answer sent:', answerData);
//           setupICECandidateListener(data.callId);
          
//           // Start the call timer
//           startTimer();
          
//           // Send buffered ICE candidates
//           sendBufferedICECandidates(data.callId);
          
//           // Set a timeout to check if the call was established
//           setTimeout(async () => {
//               if (peerConnection && 
//                   peerConnection.iceConnectionState !== 'connected' && 
//                   peerConnection.iceConnectionState !== 'completed') {
//                   console.log('Call setup timeout. Current ICE state:', peerConnection.iceConnectionState);
//                   await showCustomAlert('Call setup timed out. Please try again.');
//                   endCall();
//               }
//           }, 30000);  // 30 seconds timeout
          
//       } catch (error) {
//           console.error('Error accepting call:', error);
//           await showCustomAlert(`Error accepting call: ${error.message}`);
//           endCall();
//       }
//   } else {
//       gun.get(`calls`).get(data.callId).put({ 
//           type: 'reject',
//           from: user.is.alias,
//           to: data.from,
//           time: Date.now()
//       });
//   }
// }


async function handleIncomingCall(data) {
  if (isCallInProgress) {
      console.log('Already in a call, ignoring incoming call');
      return;
  }

  const callType = data.isVideo ? 'video' : 'voice';
  const confirmed = confirm(`Incoming ${callType} call from ${data.from}. Accept?`);

  if (confirmed) {
      try {
          isCallInProgress = true;
          isVideoCall = data.isVideo;
          
          // Get media with proper constraints
          const mediaConstraints = { 
              audio: true, 
              video: data.isVideo ? {
                  width: { ideal: 1280 },
                  height: { ideal: 720 }
              } : false 
          };
          
          localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
          console.log('Local stream obtained:', localStream.getTracks());

          // Create and show call screen
          createCallScreen(data.isVideo);

          // Set up local video if this is a video call
          if (data.isVideo) {
              const localVideo = document.getElementById('localVideo');
              if (localVideo) {
                  localVideo.srcObject = localStream;
              }
          }

          // Create peer connection
          peerConnection = await webrtcHandler.createPeerConnection();

          // Add all tracks
          localStream.getTracks().forEach(track => {
              console.log('Adding track to peer connection:', track.kind);
              peerConnection.addTrack(track, localStream);
          });

          // Set remote description first
          await peerConnection.setRemoteDescription(new RTCSessionDescription({
              type: data.offerType,
              sdp: data.offerSdp
          }));

          // Create and set local description
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);

          currentCall = {
              id: data.callId,
              to: data.from,
              from: user.is.alias,
              startTime: Date.now(),
              isVideo: data.isVideo
          };

          // Send answer
          await new Promise((resolve) => {
              gun.get('calls').get(data.callId).put({
                  type: 'answer',
                  from: user.is.alias,
                  to: data.from,
                  answerType: answer.type,
                  answerSdp: answer.sdp,
                  time: Date.now(),
                  status: 'accepted'
              }, resolve);
          });

          setupICECandidateListener(data.callId);
          sendBufferedICECandidates(data.callId);
          startTimer();

      } catch (error) {
          console.error('Error accepting call:', error);
          await showCustomAlert(`Error accepting call: ${error.message}`);
          endCall();
      }
  } else {
      gun.get('calls').get(data.callId).put({ 
          type: 'reject',
          from: user.is.alias,
          to: data.from,
          time: Date.now()
      });
  }
}

function setupPeerConnectionListeners(peerConnection) {
  peerConnection.onsignalingstatechange = () => {
      console.log('Signaling State:', peerConnection.signalingState);
      signalingState = peerConnection.signalingState;
  };

  peerConnection.oniceconnectionstatechange = () => {
      console.log('ICE Connection State:', peerConnection.iceConnectionState);
      if (peerConnection.iceConnectionState === 'failed' || 
          peerConnection.iceConnectionState === 'disconnected') {
          endCall();
      }
  };
}


function checkWebRTCSetup() {
  if (!webrtcHandler) {
    console.error('WebRTC handler not initialized');
    return false;
  }
  
  if (!peerConnection) {
    console.error('No peer connection available');
    return false;
  }
  
  // Check connection state if it exists
  if (peerConnection.connectionState) {
    console.log('Connection state:', peerConnection.connectionState);
  }
  
  // Check ICE connection state
  if (peerConnection.iceConnectionState) {
    console.log('ICE connection state:', peerConnection.iceConnectionState);
  }
  
  return true;
}


(async function () {
  const urlString = window.location.href;
  const url = new URL(urlString);
  const username = url.searchParams.get('username');
  let password = url.searchParams.get('password');
  if (username && password) {
      password += "Trus@"+password;
      try {
          await login(null, username.trim(), password.trim());
      } catch (err) {
          console.log(err);
          await register(null, username.trim(), password.trim());
          await login(null, username.trim(), password.trim());
      } 
  }
})();

const updateCallUI = (showCall = true) => {
  const headerActions = document.querySelector('.header-actions');
  if (showCall) {
      headerActions.innerHTML = `
          <button class="action-button" onclick="endCall()">
              <i class="fas fa-phone-slash"></i>
          </button>
      `;
  } else {
      headerActions.innerHTML = `
          <button class="action-button" onclick="startCall(false)">
              <i class="fas fa-phone"></i>
          </button>
          <button class="action-button" onclick="startCall(true)">
              <i class="fas fa-video"></i>
          </button>
      `;
  }
};

setInterval(() => {
  if (isCallInProgress) {
    checkWebRTCSetup();
  }
}, 5000);


function showCustomAlert(message) {
  return new Promise((resolve) => {
      const statusDialog = document.getElementById('statusDialog');
      const statusTitle = document.getElementById('statusTitle');
      const statusMessage = document.getElementById('statusMessage');
      
      statusTitle.textContent = 'Alert';
      statusMessage.textContent = message;
      
      const closeButton = statusDialog.querySelector('.dialog-button');
      const originalClickHandler = closeButton.onclick;
      
      closeButton.onclick = () => {
          closeDialog('statusDialog');
          closeButton.onclick = originalClickHandler;
          resolve();
      };
      
      openDialog('statusDialog');
  });
}


function showCustomConfirm(message) {
  return new Promise((resolve) => {
      // Create confirmation dialog dynamically
      const dialogOverlay = document.createElement('div');
      dialogOverlay.className = 'dialog-overlay';
      dialogOverlay.id = 'confirmDialog';
      
      dialogOverlay.innerHTML = `
          <div class="dialog-box">
              <h3>Confirm</h3>
              <p style="text-align: center; margin-bottom: 20px;">${message}</p>
              <div class="dialog-buttons">
                  <button class="dialog-button cancel">Cancel</button>
                  <button class="dialog-button confirm">Confirm</button>
              </div>
          </div>
      `;
      
      document.body.appendChild(dialogOverlay);
      
      const handleResponse = (confirmed) => {
          document.body.removeChild(dialogOverlay);
          resolve(confirmed);
      };
      
      dialogOverlay.querySelector('.cancel').onclick = () => handleResponse(false);
      dialogOverlay.querySelector('.confirm').onclick = () => handleResponse(true);
      
      dialogOverlay.classList.add('show');
  });
}


function toggleMute() {
  if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
          audioTrack.enabled = !audioTrack.enabled;
          const muteButton = document.getElementById('muteButton');
          muteButton.innerHTML = `<i class="fas fa-microphone${audioTrack.enabled ? '' : '-slash'}"></i>`;
      }
  }
}

function toggleVideo() {
  if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
          videoTrack.enabled = !videoTrack.enabled;
          const videoButton = document.getElementById('videoButton');
          videoButton.innerHTML = `<i class="fas fa-video${videoTrack.enabled ? '' : '-slash'}"></i>`;
      }
  }
}

function setupSearch() {
  const searchBox = document.querySelector('.search-box');
  searchBox.addEventListener('input', (e) => {
      const searchTerm = e.target.value.toLowerCase();
      const currentTab = state.currentView;
      
      if (currentTab === 'contacts') {
          const contacts = document.querySelectorAll('#contactsList .contact-item');
          contacts.forEach(contact => {
              const name = contact.querySelector('.contact-name').textContent.toLowerCase();
              contact.style.display = name.includes(searchTerm) ? 'flex' : 'none';
          });
      } else {
          const streams = document.querySelectorAll('#streamsList .stream-item');
          streams.forEach(stream => {
              const name = stream.querySelector('.name').textContent.toLowerCase();
              stream.style.display = name.includes(searchTerm) ? 'flex' : 'none';
          });
      }
  });
}
