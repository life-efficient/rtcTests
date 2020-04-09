import AWS from "aws-sdk"
import { SignalingClient, Role } from "amazon-kinesis-video-streams-webrtc"
import { Auth } from "aws-amplify"

const region = 'eu-west-1'
const natTraversalDisabled = false
const forceTURN = true 
const openDataChannel = true
const useTrickleICE = true 

export default class Master {
    constructor(localStream, localScreen, channelName, onRemoteDataMessage, onStatsReport, id, log) {
        this.localStream = localStream
        this.localScreen = localScreen
        this.channelName = channelName
        this.onRemoteDataMessage = onRemoteDataMessage
        this.onStatsReport = onStatsReport
        this.id = id
        this._log = log
        // this.remoteStreamsByClientId = {}
        this.peerConnectionByClientId = {}
        this.dataChannelByClientId = {}
        this.webcamSendersByClientId = {}
        this.screenshareSendersByClientId = {}
        this.sharedStreams = {}
        this.startMaster()
        // setInterval(()=>{console.log('peerconnectionsbyid:', this.peerConnectionByClientId)}, 3000)
    }

    log = (log_item) => {
        this._log({id: this.id, item: log_item})
    }

    startMaster = async () => {
        console.log('starting master')

        const creds = await Auth.currentCredentials()
        const accessKeyId = creds.accessKeyId
        const sessionToken = creds.sessionToken
        const secretAccessKey = creds.secretAccessKey

        this.log('starting master')

        console.log('creating KVS client')
        // Create KVS client
        const kinesisVideoClient = new AWS.KinesisVideo({
            region,
            accessKeyId,
            secretAccessKey,
            sessionToken,
            // endpoint: .endpoint,
        });

        console.log('getting signaling channel ARN')
        // Get signaling channel ARN
        const describeSignalingChannelResponse = await kinesisVideoClient
            .describeSignalingChannel({
                ChannelName: this.channelName,
            })
            .promise();
        const channelARN = describeSignalingChannelResponse.ChannelInfo.ChannelARN;
        console.log('[MASTER] Channel ARN: ', channelARN);

        console.log('getting signaling channel endpoints')
        // Get signaling channel endpoints
        const getSignalingChannelEndpointResponse = await kinesisVideoClient
            .getSignalingChannelEndpoint({
                ChannelARN: channelARN,
                SingleMasterChannelEndpointConfiguration: {
                    Protocols: ['WSS', 'HTTPS'],
                    Role: Role.MASTER,
                },
            })
            .promise();
        const endpointsByProtocol = getSignalingChannelEndpointResponse.ResourceEndpointList.reduce((endpoints, endpoint) => {
            endpoints[endpoint.Protocol] = endpoint.ResourceEndpoint;
            return endpoints;
        }, {});
        console.log('[MASTER] Endpoints: ', endpointsByProtocol);

        console.log('creating signaling client')
        // Create Signaling Client
        this.signalingClient = new SignalingClient({
            channelARN,
            channelEndpoint: endpointsByProtocol.WSS,
            role: Role.MASTER,
            region,
            credentials: {
                accessKeyId,
                secretAccessKey,
                sessionToken,
            },
        })
        this.log('created signaling client')

        // console.log('getting ICE server configuration')
        // Get ICE server configuration
        const kinesisVideoSignalingChannelsClient = new AWS.KinesisVideoSignalingChannels({
            region,
            accessKeyId,
            secretAccessKey,
            sessionToken,
            endpoint: endpointsByProtocol.HTTPS,
        });
        const getIceServerConfigResponse = await kinesisVideoSignalingChannelsClient
            .getIceServerConfig({
                ChannelARN: channelARN,
            })
            .promise();
        const iceServers = [];
        if (!natTraversalDisabled && !forceTURN) {
            iceServers.push({ urls: `stun:stun.kinesisvideo.${region}.amazonaws.com:443` });
        }
        if (!natTraversalDisabled) {
            getIceServerConfigResponse.IceServerList.forEach(iceServer =>
                iceServers.push({
                    urls: iceServer.Uris,
                    username: iceServer.Username,
                    credential: iceServer.Password,
                }),
            );
        }
        // console.log('[MASTER] ICE servers: ', iceServers);

        const configuration = {
            iceServers,
            iceTransportPolicy: forceTURN ? 'relay' : 'all',
            // sdpSemantics: 'unified-plan'
        };

        //
        // this.signalingClient.on('open', async () => {
        //     console.log('[MASTER] Connected to signaling service');
        // });

        // HANDLE SDP OFFER
        this.signalingClient.on('sdpOffer', async (offer, remoteClientId) => {

            this.log(`[MASTER] got SDP offer from ${remoteClientId}`)
            // GET (AND SET) THE PEERCONNECTION
             var peerConnection
            if (!Object.keys(this.peerConnectionByClientId).includes(remoteClientId)) {
                this.initiatePeerConnection(remoteClientId, configuration)
                console.log(this.peerConnectionByClientId)
                peerConnection = this.peerConnectionByClientId[remoteClientId]
            }
            else {
                console.log('[MASTER] handling SDP offer from existing client:', remoteClientId)
                peerConnection = this.peerConnectionByClientId[remoteClientId]
            }

            await peerConnection.setRemoteDescription(offer); // (4) set remote desc 
            this.log('[MASTER] set remote description')
                   
            await peerConnection.setLocalDescription( // (6) // set local dsc
                await peerConnection.createAnswer({ // (5) Create an SDP answer to send back to the client
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: true,
                })
            )
            this.log('[MASTER] created SDP answer')
            this.log('[MASTER] set local description')

            // When trickle ICE is enabled, send the answer now and then send ICE candidates as they are generated. Otherwise wait on the ICE candidates.
            if (useTrickleICE) {
                console.log('[MASTER] Sending SDP answer to client: ' + remoteClientId);
                this.signalingClient.sendSdpAnswer(peerConnection.localDescription, remoteClientId); // (7) send the local desc, which was set to the sdp answer, back to the sender
                this.log('[MASTER] sent SDP answer')
            }

        });

        this.signalingClient.on('iceCandidate', async (candidate, remoteClientId) => {
            // console.log('[MASTER] Received ICE candidate from client: ' + remoteClientId);

            // Add the ICE candidate received from the client to the peer connection
            const peerConnection = this.peerConnectionByClientId[remoteClientId];
            peerConnection.addIceCandidate(candidate);
            this.peerConnectionByClientId = {...this.peerConnectionByClientId, [remoteClientId]: peerConnection}
        });

        this.signalingClient.on('open', ()=>{
            console.log('[MASTER] Connected to signaling service');
            this.log('[MASTER] opened signaling client')
        })

        this.signalingClient.on('close', () => {
            console.log('[MASTER] Disconnected from signaling channel');
            this.log('[MASTER] signaling channel closed')
        });

        this.signalingClient.on('error', () => {
            console.error('[MASTER] Signaling client error');
        });

        this.signalingClient.open();
        console.log('finished setting up master')
    }

    initiatePeerConnection = (remoteClientId, configuration) => {
        console.log('[MASTER] handling SDP offer from new client:', remoteClientId)
        var peerConnection = new RTCPeerConnection(configuration); // Create a new peer connection using the offer from the given client
        this.peerConnectionByClientId = {...this.peerConnectionByClientId, [remoteClientId]: peerConnection};
        this.log(`[MASTER] created peer connection with ${remoteClientId}`)
        console.log(remoteClientId)
        console.log(this.peerConnectionByClientId)

        // INITIATE DATA CHANNEL
        if (openDataChannel) {
            this.dataChannelByClientId = {
                ...this.dataChannelByClientId,
                [remoteClientId]: peerConnection.createDataChannel('kvsDataChannel')
            }
            peerConnection.ondatachannel = event => {
                event.channel.onmessage = (message) =>{
                    this.onRemoteDataMessage(message);
                }
            };
        }

        // POLL FOR CONNECTION STATS
        if (!this.peerConnectionStatsInterval) {
            console.log('setting callback to get stats from peerConnection')
            this.peerConnectionStatsInterval = setInterval(() => peerConnection.getStats().then(this.onStatsReport), 10000);
        }

        // SEND ANY ICE CANDIDATES TO THE OTHER PEER
        console.log('setting peerConnection event handler for "icecandidate" (this ICE candidate can be sent to the remote peer)')
        peerConnection.addEventListener('icecandidate', ({ candidate }) => {
            if (candidate) {
                // console.log('[MASTER] Generated ICE candidate for client: ' + remoteClientId);
                // When trickle ICE is enabled, send the ICE candidates as they are generated.
                if (useTrickleICE) {
                    // console.log('[MASTER] Sending ICE candidate to client: ' + remoteClientId);
                    this.signalingClient.sendIceCandidate(candidate, remoteClientId);
                }
            } else {
                console.log('[MASTER] All ICE candidates have been generated for client: ' + remoteClientId);
                // When trickle ICE is disabled, send the answer now that all the ICE candidates have ben generated.
                if (!useTrickleICE) {
                    console.log('[MASTER] Sending SDP answer to client: ' + remoteClientId);
                    this.signalingClient.sendSdpAnswer(peerConnection.localDescription, remoteClientId);
                }
            }
        });

        // AS REMOTE TRACKS ARE RECEIVED, ADD THEM TO THE REMOTE VIEW
        console.log('setting peerConnection event handler for "track" (adding track)')
        peerConnection.addEventListener('track', async event => {
            console.log('[MASTER] Received remote track from client: ' + remoteClientId);
        });

        // ADD CURRENTLY SHARED TRACKS
        if (this.sharedStreams.webcam) { // if webcam being shared
            var senders = []
            var stream = this.sharedStreams.webcam // get webcam stream
            stream.getTracks().forEach(track=>{ // for each track
                senders.push(peerConnection.addTrack(track, stream)) // add track and get sender
                this.log(`[MASTER] added track upon initialising peerConnection with client ${remoteClientId}`)
            })
            this.webcamSendersByClientId[remoteClientId] = senders // set client's senders
        }
        if (this.sharedStreams.screenshare) { // if webcam being shared
            var senders = []
            var stream = this.sharedStreams.screenshare // get webcam stream
            stream.getTracks().forEach(track=>{ // for each track
                senders.push(peerConnection.addTrack(track, stream)) // add track and get sender
                this.log(`[MASTER] added track upon initialising peerConnection with client ${remoteClientId}`)
            })
            this.screenshareSendersByClientId[remoteClientId] = senders // set client's senders
        }
        // var tracks = []
        // tracks.push(this.localStream.getTracks())
        // var senders = []
        // tracks.flat().forEach(track => {
        //     console.log('adding local track:', track)
        //     senders.push(peerConnection.addTrack(track, this.localStream))
        // });

        // HANDLE ICE STATE CHANGE
        peerConnection.oniceconnectionstatechange = ()=>{
            console.log('new connection state:', peerConnection.iceConnectionState)
            this.log(`ice connection state changed to ${peerConnection.iceConnectionState}`)
            if (peerConnection.iceConnectionState == 'disconnected') {
                console.log(`client ${remoteClientId} disconnected`)
                // peerConnection.close()
            }
        }
        
        // HANDLE NEGOTIATION
        peerConnection.onnegotiationneeded = async () => {
            console.log('[MASTER] NEGOTIATION NEEDED')
            this.log(`[MASTER] ${remoteClientId} needs negotiation`)
            await peerConnection.setLocalDescription( // (2) set own local desc to that offer
                await peerConnection.createOffer({ // (1) create SDP offer
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: true,
                }),
            );
            this.log('[MASTER] created SDP offer')
            this.log('[MASTER] set local description')
            this.signalingClient.sendSdpOffer(peerConnection.localDescription, remoteClientId); // (3) send sdp offer to reciever
            this.log(`[MASTER] sent sdp offer to ${remoteClientId}`)
            // alert('[MASTER] creates sdp offer, set local desc, and sent sdp offer')
        }

        console.log('[MASTER] Generating ICE candidates for client: ' + remoteClientId);
    }

    replaceVideoStream = (stream) => {
        // if (!stream) {
        //     Object.values(this.peerConnectionByClientId).forEach(pc=>{
        //         var senders = pc.getSenders()
        //         var sender = senders.find(s=>{return s.track.kind == 'video'})
        //         sender.replaceTrack(null)
        //     })
        //     return
        // }
        let track = stream ? stream.getVideoTracks()[0] : null
        Object.values(this.peerConnectionByClientId).forEach(pc=>{
            var senders = pc.getSenders()
            var sender = senders.find(s=>{return s.track.kind == 'video'})
            sender.replaceTrack(track)
            // console.log(senders)
            // senders.forEach(s=>{console.log(s.track);console.log(s.track)})
        })
        // alert('replaced track')
    }

    toggleWebcam = (stream) => {
        console.log('[MASTER] toggling webcam')
        console.log(stream)
        if (stream) { // must be turnign stream on if it's provided
            console.log('adding webcam')
            this.sharedStreams = {
                ...this.sharedStreams, 
                webcam: stream
            }
            this.log('[MASTER] added webcam to master')
            // ADD TO ALL EXISTING PEERCONNECTIONS
            stream.getTracks().forEach(track => {
                console.log('adding local track:', track)
                Object.keys(this.peerConnectionByClientId).forEach(clientId=>{
                    // ADD TRACKS
                    var senders = []
                    senders.push(this.peerConnectionByClientId[clientId].addTrack(track, stream))
                    this.log(`[MASTER] added track for client ${clientId}`)
                    this.webcamSendersByClientId[clientId] = senders
                });
            })
            // alert('added stream')
                // let senders = []
                // stream.getTracks().forEach(track=>{
                //     senders.push(this.peerConnectionByClientId[clientId].addTrack(track, stream))
                // })
                // this.webcamSendersByClientId[clientId] = senders
        }
        else {
            Object.keys(this.peerConnectionByClientId).forEach(clientId=>{
                let pc = this.peerConnectionByClientId[clientId]
                this.webcamSendersByClientId[clientId].forEach(
                    sender=>{
                        pc.removeTrack(sender)
                        this.log(`removed track for client ${clientId}`)
                    }
                )
            })
            delete this.sharedStreams.webcam
        }
    }
    toggleScreenshare = (stream) => {
        console.log('[MASTER] toggling screenshare')
        console.log(stream)
        if (stream) { // must be turnign stream on if it's provided
            console.log('adding screenshare')
            this.sharedStreams = {
                ...this.sharedStreams, 
                screenshare: stream
            }
            this.log('[MASTER] added screenshare to master')
            // ADD TO ALL EXISTING PEERCONNECTIONS
            stream.getTracks().forEach(track => {
                console.log('adding local track:', track)
                Object.keys(this.peerConnectionByClientId).forEach(clientId=>{
                    // ADD TRACKS
                    var senders = []
                    senders.push(this.peerConnectionByClientId[clientId].addTrack(track, stream))
                    this.log(`[MASTER] added track for client ${clientId}`)
                    this.screenshareSendersByClientId[clientId] = senders
                });
            })
        }
        else {
            Object.keys(this.peerConnectionByClientId).forEach(clientId=>{
                let pc = this.peerConnectionByClientId[clientId]
                this.screenshareSendersByClientId[clientId].forEach(
                    sender=>{
                        pc.removeTrack(sender)
                        this.log(`removed track for client ${clientId}`)
                    }
                )
            })
            delete this.sharedStreams.screenshare
        }
    }

    sendMasterMessage = (message) => {
        Object.keys(this.dataChannelByClientId).forEach(clientId => {
            try {
                this.dataChannelByClientId[clientId].send(message);
            } catch (e) {
                console.error('[MASTER] Send DataChannel: ', e.toString());
            }
        });
    }

    stopMaster = () => {
        console.log('[MASTER] Stopping peerConnection');
        
        if (this.signalingClient) {
            this.signalingClient.close();
            this.signalingClient = null;
        }

        Object.keys(this.peerConnectionByClientId).forEach(clientId => {
            this.peerConnectionByClientId[clientId].close();
        });
        this.peerConnectionByClientId = [];

        if (this.localScreen) {
            this.localScreen.getTracks().forEach(track => track.stop());
            this.localScreen = null;
        }
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        // Object.values(this.remoteStreamsByClientId).forEach(remoteStream => remoteStream.getTracks().forEach(track => track.stop()));
        // this.remoteStreamsByClientId = {};

        if (this.peerConnectionStatsInterval) {
            clearInterval(this.peerConnectionStatsInterval);
            this.peerConnectionStatsInterval = null;
        }

        if (this.dataChannelByClientId) {
            this.dataChannelByClientId = {};
        }

        this.log('[MASTER] stopped')
    }
}
