const iceServers = [
  { urls: "stun:stun.relay.metered.ca:80" },
  {
    urls: "turn:global.relay.metered.ca:80",
    username: "71a361258c2adc3899957a54",
    credential: "bwZZBXve8wmhiS/A",
  },
  {
    urls: "turn:global.relay.metered.ca:443",
    username: "71a361258c2adc3899957a54",
    credential: "bwZZBXve8wmhiS/A",
  },
];

class WebRTCHandler {
  constructor(onIceCandidate, onTrack) {
    this.peerConnection = null;
    this.localStream = null;
    this.onIceCandidate = onIceCandidate;
    this.onTrack = onTrack;
    this.iceCandidates = [];
  }

  async createPeerConnection() {
    const configuration = {
      iceServers,
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceCandidatePoolSize: 0
    };

    this.peerConnection = new RTCPeerConnection(configuration);
    
    this.peerConnection.onicecandidate = this.onIceCandidate;

    this.peerConnection.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', this.peerConnection.iceConnectionState);
      if (this.peerConnection.iceConnectionState === 'failed') {
        console.log('Attempting to restart ICE');
        this.peerConnection.restartIce();
      }
    };

    this.peerConnection.onicegatheringstatechange = () => {
      console.log('ICE gathering state:', this.peerConnection.iceGatheringState);
    };

    this.peerConnection.onsignalingstatechange = () => {
      console.log('Signaling state:', this.peerConnection.signalingState);
    };

    this.peerConnection.onconnectionstatechange = () => {
      console.log('Connection state:', this.peerConnection.connectionState);
      if (this.peerConnection.connectionState === 'failed') {
        console.log('Connection failed. Attempting to recreate the peer connection.');
        this.recreatePeerConnection();
      }
    };

    this.peerConnection.ontrack = this.onTrack;

    return this.peerConnection;
  }

  async recreatePeerConnection() {
    if (this.peerConnection) {
      this.peerConnection.close();
    }
    await this.createPeerConnection();
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => this.peerConnection.addTrack(track, this.localStream));
    }
    // Trigger renegotiation if necessary
  }

  async addIceCandidate(candidate) {
    try {
      if (this.peerConnection.remoteDescription && this.peerConnection.iceConnectionState !== 'closed') {
        await this.peerConnection.addIceCandidate(candidate);
        console.log('Added ICE candidate successfully');
      } else {
        this.iceCandidates.push(candidate);
        console.log('ICE candidate buffered');
      }
    } catch (error) {
      console.error('Error adding received ICE candidate', error);
    }
  }

  async startCall(stream, isVideo) {
    this.localStream = stream;
    this.localStream.getTracks().forEach(track => {
      console.log('Adding local track to peer connection:', track.kind);
      this.peerConnection.addTrack(track, this.localStream);
    });

    const offer = await this.peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: isVideo
    });
    await this.peerConnection.setLocalDescription(offer);
    console.log('Local description set:', offer.type);

    return offer;
  }

  async handleIncomingCall(offer, stream) {
    this.localStream = stream;
    this.localStream.getTracks().forEach(track => {
      console.log('Adding local track to peer connection:', track.kind);
      this.peerConnection.addTrack(track, this.localStream);
    });

    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    console.log('Remote description set:', offer.type);

    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    console.log('Local description set:', answer.type);

    // Add any buffered ICE candidates
    for (const candidate of this.iceCandidates) {
      await this.peerConnection.addIceCandidate(candidate);
    }
    this.iceCandidates = [];

    return answer;
  }
}

// Make WebRTCHandler available globally
window.WebRTCHandler = WebRTCHandler;