// webrtc.js

const iceServers = [
    { urls: "stun:stun.relay.metered.ca:80" },
    {
      urls: "turn:global.relay.metered.ca:80",
      username: "71a361258c2adc3899957a54",
      credential: "bwZZBXve8wmhiS/A",
    },
    {
      urls: "turn:global.relay.metered.ca:80?transport=tcp",
      username: "71a361258c2adc3899957a54",
      credential: "bwZZBXve8wmhiS/A",
    },
    {
      urls: "turn:global.relay.metered.ca:443",
      username: "71a361258c2adc3899957a54",
      credential: "bwZZBXve8wmhiS/A",
    },
    {
      urls: "turns:global.relay.metered.ca:443?transport=tcp",
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
      this.connectionAttempts = 0;
      this.maxAttempts = 3;
    }
  
    async createPeerConnection() {
        this.peerConnection = new RTCPeerConnection({ iceServers });
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('New ICE candidate:', event.candidate.type, event.candidate.protocol, event.candidate.address);
                this.onIceCandidate(event.candidate);
            }
        };
  
        this.peerConnection.oniceconnectionstatechange = () => {
            console.log('ICE connection state:', this.peerConnection.iceConnectionState);
            if (this.peerConnection.iceConnectionState === 'failed') {
            this.handleConnectionFailure();
            }
        };
  
      this.peerConnection.ontrack = this.onTrack;
  
      return this.peerConnection;
    }

    async addIceCandidate(candidate) {
        try {
          await this.peerConnection.addIceCandidate(candidate);
          console.log('Added ICE candidate successfully');
        } catch (error) {
          console.error('Error adding received ICE candidate', error);
        }
    }

    async startCall(stream) {
        stream.getTracks().forEach(track => this.peerConnection.addTrack(track, stream));

        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);

        return offer;
    }

    async handleIncomingCall(offer, stream) {
        stream.getTracks().forEach(track => this.peerConnection.addTrack(track, stream));

        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);

        return answer;
    }
  
    // handleConnectionFailure() {
    //   console.error('Connection failed. Attempting fallback options...');
      
    //   if (this.connectionAttempts < this.maxAttempts) {
    //     this.connectionAttempts++;
    //     this.peerConnection.restartIce();
    //   } else {
    //     console.error('Max connection attempts reached. Ending call.');
    //     this.endCall();
    //   }
    // }
  
    // setProgressiveConnectionTimeout() {
    //   const baseTimeout = 20000; // 20 seconds
    //   const timeout = baseTimeout * (this.connectionAttempts + 1);
      
    //   setTimeout(() => {
    //     if (this.peerConnection && this.peerConnection.iceConnectionState !== 'connected' && this.peerConnection.iceConnectionState !== 'completed') {
    //       console.error(`Connection attempt ${this.connectionAttempts + 1} timed out after ${timeout}ms`);
    //       this.handleConnectionFailure();
    //     }
    //   }, timeout);
    // }
  
    // endCall() {
    //   if (this.peerConnection) {
    //     this.peerConnection.close();
    //     this.peerConnection = null;
    //   }
    //   if (this.localStream) {
    //     this.localStream.getTracks().forEach(track => track.stop());
    //     this.localStream = null;
    //   }
    // }
  }
  
  // Make WebRTCHandler available globally
  window.WebRTCHandler = WebRTCHandler;