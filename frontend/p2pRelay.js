// class P2PRelay {
//     constructor() {
//         this.node = null;
//         this.peers = new Map();
//         this.isRelayNode = false;
//         this.bandwidth = 0;
//         this.relayConnections = new Map();
//         this.maxConnections = 0;
//     }

//     async init() {
//         try {
//             // Check if libp2p is available
//             console.log('window.Libp2p', window.Libp2p);
//             if (typeof window.Libp2p === 'undefined') {
//                 throw new Error('Libp2p is not loaded');
//             }

//             this.node = await window.Libp2p.create({
//                 addresses: {
//                     listen: [
//                         '/dns4/wrtc-star1.par.dwebops.pub/tcp/443/wss/p2p-webrtc-star'
//                     ]
//                 },
//                 modules: {
//                     transport: [window.Libp2pWebrtcStar.webRTCStar()],
//                     streamMuxer: [window.Libp2pMplex.mplex],
//                     connEncryption: [window.Libp2pNoise.noise],
//                     peerDiscovery: [window.Libp2pBootstrap.bootstrap]
//                 },
//                 config: {
//                     peerDiscovery: {
//                         bootstrap: {
//                             list: [
//                                 '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN'
//                             ]
//                         }
//                     },
//                     relay: {
//                         enabled: true,
//                         hop: {
//                             enabled: true,
//                             active: false
//                         }
//                     }
//                 }
//             });

//             await this.node.start();
//             console.log('P2P node started with ID:', this.node.peerId.toString());

//             // Measure bandwidth and determine if this node can be a relay
//             await this.measureBandwidth();
            
//             // Setup event handlers
//             this.setupEventHandlers();

//             return true;
//         } catch (error) {
//             console.error('Failed to initialize P2P node:', error);
//             return false;
//         }
//     }

//     async measureBandwidth() {
//         try {
//             const startTime = Date.now();
//             const response = await fetch('https://www.google.com/favicon.ico');
//             const blob = await response.blob();
//             const endTime = Date.now();
            
//             const size = blob.size;
//             const duration = (endTime - startTime) / 1000;
//             this.bandwidth = (size * 8) / duration; // bits per second

//             // Determine max connections based on bandwidth
//             // Assuming each connection needs at least 500Kbps
//             this.maxConnections = Math.floor(this.bandwidth / (500 * 1024));
            
//             console.log(`Measured bandwidth: ${this.bandwidth} bps, Max connections: ${this.maxConnections}`);
            
//             // If bandwidth is good enough, become a relay node
//             if (this.maxConnections >= 1) {
//                 await this.becomeRelayNode();
//             }

//             return this.bandwidth;
//         } catch (error) {
//             console.error('Bandwidth measurement failed:', error);
//             return 0;
//         }
//     }

//     async becomeRelayNode() {
//         if (this.maxConnections < 1) return false;

//         try {
//             this.isRelayNode = true;
//             this.node.relay.hop.active = true;

//             // Announce as relay node
//             await this.node.pubsub.publish('relay-announce', 
//                 new TextEncoder().encode(JSON.stringify({
//                     peerId: this.node.peerId.toString(),
//                     bandwidth: this.bandwidth,
//                     maxConnections: this.maxConnections,
//                     currentLoad: this.relayConnections.size
//                 }))
//             );

//             return true;
//         } catch (error) {
//             console.error('Error becoming relay node:', error);
//             return false;
//         }
//     }

//     setupEventHandlers() {
//         // Handle incoming relay requests
//         this.node.handle('/relay-request/1.0.0', async ({ stream, connection }) => {
//             if (!this.isRelayNode || this.relayConnections.size >= this.maxConnections) {
//                 stream.end();
//                 return;
//             }

//             const peerId = connection.remotePeer.toString();
//             this.relayConnections.set(peerId, {
//                 stream,
//                 timestamp: Date.now()
//             });

//             // Handle stream closure
//             stream.on('close', () => {
//                 this.relayConnections.delete(peerId);
//             });
//         });

//         // Monitor network conditions
//         setInterval(() => {
//             this.measureBandwidth();
//             this.cleanupStaleConnections();
//         }, 60000); // Every minute
//     }

//     async findRelayPeer() {
//         try {
//             const peers = Array.from(this.peers.values())
//                 .filter(peer => peer.isRelay && peer.currentLoad < peer.maxConnections)
//                 .sort((a, b) => 
//                     (b.bandwidth / b.currentLoad) - (a.bandwidth / a.currentLoad)
//                 );

//             return peers[0]?.peerId;
//         } catch (error) {
//             console.error('Error finding relay peer:', error);
//             return null;
//         }
//     }

//     async relayConnection(targetPeerId) {
//         const relayPeer = await this.findRelayPeer();
//         if (!relayPeer) {
//             throw new Error('No suitable relay peer found');
//         }

//         try {
//             const { stream } = await this.node.dialProtocol(relayPeer, '/relay-request/1.0.0');
//             return stream;
//         } catch (error) {
//             console.error('Error establishing relay connection:', error);
//             throw error;
//         }
//     }

//     cleanupStaleConnections() {
//         const now = Date.now();
//         for (const [peerId, connection] of this.relayConnections) {
//             if (now - connection.timestamp > 3600000) { // 1 hour
//                 connection.stream.end();
//                 this.relayConnections.delete(peerId);
//             }
//         }
//     }
// }

// // Export for global use
// window.P2PRelay = P2PRelay;




















class P2PRelay {
    constructor() {
        this.node = null;
        this.peers = new Map();
        this.isRelayNode = false;
        this.bandwidth = 0;
        this.relayConnections = new Map();
        this.maxConnections = 0;
    }

    async init() {
        try {
            // Wait for libp2p to be available
            await this.waitForLibp2p();

            const options = {
                addresses: {
                    listen: [
                        '/dns4/wrtc-star1.par.dwebops.pub/tcp/443/wss/p2p-webrtc-star'
                    ]
                },
                transports: [libp2p.webSockets],
                streamMuxers: [libp2p.mplex],
                connectionEncryption: [libp2p.noise],
                peerDiscovery: [libp2p.bootstrap],
                config: {
                    peerDiscovery: {
                        bootstrap: {
                            enabled: true,
                            list: [
                                '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN'
                            ]
                        }
                    },
                    relay: {
                        enabled: true,
                        hop: {
                            enabled: true,
                            active: false
                        }
                    }
                }
            };

            this.node = await libp2p.create(options);
            await this.node.start();
            console.log('P2P node started with ID:', this.node.peerId.toString());

            await this.measureBandwidth();
            this.setupEventHandlers();

            return true;
        } catch (error) {
            console.error('Failed to initialize P2P node:', error);
            return false;
        }
    }

    waitForLibp2p() {
        return new Promise((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 10;
            const checkLibp2p = () => {
                if (typeof window.libp2p !== 'undefined') {
                    resolve();
                } else if (attempts >= maxAttempts) {
                    reject(new Error('Libp2p failed to load'));
                } else {
                    attempts++;
                    setTimeout(checkLibp2p, 500);
                }
            };
            checkLibp2p();
        });
    }

    async measureBandwidth() {
        try {
            const startTime = Date.now();
            const response = await fetch('https://www.google.com/favicon.ico');
            const blob = await response.blob();
            const endTime = Date.now();
            
            const size = blob.size;
            const duration = (endTime - startTime) / 1000;
            this.bandwidth = (size * 8) / duration;
            
            this.maxConnections = Math.floor(this.bandwidth / (500 * 1024));
            console.log(`Measured bandwidth: ${this.bandwidth} bps, Max connections: ${this.maxConnections}`);
            
            if (this.maxConnections >= 1) {
                await this.becomeRelayNode();
            }

            return this.bandwidth;
        } catch (error) {
            console.error('Bandwidth measurement failed:', error);
            return 0;
        }
    }

    async becomeRelayNode() {
        if (this.maxConnections < 1) return false;

        try {
            this.isRelayNode = true;
            if (this.node.relay) {
                this.node.relay.hop.active = true;
            }
            return true;
        } catch (error) {
            console.error('Error becoming relay node:', error);
            return false;
        }
    }

    setupEventHandlers() {
        if (!this.node) return;

        this.node.addEventListener('peer:discovery', (evt) => {
            const peer = evt.detail.id.toString();
            console.log('Discovered peer:', peer);
        });

        this.node.addEventListener('peer:connect', (evt) => {
            const peer = evt.detail.remotePeer.toString();
            console.log('Connected to peer:', peer);
        });
    }

    async findRelayPeer() {
        if (!this.node) return null;
        
        const peers = Array.from(this.node.getPeers())
            .filter(peer => peer.protocols.includes('/libp2p/relay/0.1.0'));
        
        return peers.length > 0 ? peers[0] : null;
    }
}