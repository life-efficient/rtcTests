
import AWS from "aws-sdk"
import { SignalingClient, Role } from "amazon-kinesis-video-streams-webrtc"
import { Auth } from "aws-amplify"

export default class Viewer {
    constructor(channelName, setStreams, onRemoteDataMessage, onStatsReport, id, log) {
        this.channelName = channelName
        this.setStreams = setStreams
        this.onRemoteDataMessage = onRemoteDataMessage
        this.onStatsReport = onStatsReport
        this.id = id
        this._log = log
        this.peerConnectionByClientId = {}
        this.dataChannelByClientId = {}
        this.remoteStreams = []
        this.peerConnectionStatsInterval = null
        // sharing_screen: false,
        // screen_track_senders: null,
        // sharing_webcam: false,
        // webcam_track_senders: null
        this.startViewer()
        
    }

    log = (log_item) => {
        this._log({id: this.id, item: log_item})
    }

    startViewer = async () => {
        const region = 'eu-west-1'
        const natTraversalDisabled = false
        const forceTURN = true
        const openDataChannel = true
        const useTrickleICE = true

        const creds = await Auth.currentCredentials()
        const accessKeyId = creds.accessKeyId
        const sessionToken = creds.sessionToken
        const secretAccessKey = creds.secretAccessKey

        this.log('[VIEWER] starting viewer')

        // Create KVS client
        const kinesisVideoClient = new AWS.KinesisVideo({
            region: region,
            accessKeyId: accessKeyId,
            secretAccessKey: secretAccessKey,
            sessionToken: sessionToken,
            // endpoint: endpoint,
        });

        // Get signaling channel ARN
        const describeSignalingChannelResponse = await kinesisVideoClient
            .describeSignalingChannel({
                ChannelName: this.channelName,
            })
            .promise();
        const channelARN = describeSignalingChannelResponse.ChannelInfo.ChannelARN;
        // console.log('[VIEWER] Channel ARN: ', channelARN);

        // Get signaling channel endpoints
        const getSignalingChannelEndpointResponse = await kinesisVideoClient
            .getSignalingChannelEndpoint({
                ChannelARN: channelARN,
                SingleMasterChannelEndpointConfiguration: {
                    Protocols: ['WSS', 'HTTPS'],
                    Role: Role.VIEWER,
                },
            })
            .promise();
        const endpointsByProtocol = getSignalingChannelEndpointResponse.ResourceEndpointList.reduce((endpoints, endpoint) => {
            endpoints[endpoint.Protocol] = endpoint.ResourceEndpoint;
            return endpoints;
        }, {});
        // console.log('[VIEWER] Endpoints: ', endpointsByProtocol);

        const kinesisVideoSignalingChannelsClient = new AWS.KinesisVideoSignalingChannels({
            region: region,
            accessKeyId: accessKeyId,
            secretAccessKey: secretAccessKey,
            sessionToken: sessionToken,
            endpoint: endpointsByProtocol.HTTPS,
        });

        // Get ICE server configuration
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
        // console.log('[VIEWER] ICE servers: ', iceServers);

        // Create Signaling Client
        this.signalingClient = new SignalingClient({
            channelARN,
            channelEndpoint: endpointsByProtocol.WSS,
            clientId: this.id,
            // clientId: 'viewerID',
            role: Role.VIEWER,
            region: region,
            credentials: {
                accessKeyId: accessKeyId,
                secretAccessKey: secretAccessKey,
                sessionToken: sessionToken,
            },
        })
        this.log('[VIEWER] created signaling client')
        this.signalingClient.open();

        const configuration = {
            iceServers,
            iceTransportPolicy: forceTURN ? 'relay' : 'all',
            // sdpSemantics: 'unified-plan',
            // sdpSemantics: 'plan-b',
        };
        var peerConnection = new RTCPeerConnection(configuration);
        this.log('[VIEWER] created peer connection')
        if (openDataChannel) {
            this.dataChannel = peerConnection.createDataChannel('kvsDataChannel')
            peerConnection.ondatachannel = event => {
                event.channel.onmessage = this.onRemoteDataMessage
            };
        }

        this.signalingClient.on('sdpOffer', async (offer, remoteClientId) => {

            console.log('[VIEWER] handling sdp offer from:', remoteClientId)
            this.log(`[VIEWER] got SDP offer from ${remoteClientId}`)

            // // GET (AND SET) THE PEERCONNECTION
            // var peerConnection
            // if (!Object.keys(this.peerConnectionByClientId).includes(remoteClientId)) {
            //     this.initiatePeerConnection(remoteClientId, configuration)
            //     peerConnection = this.state.peerConnectionByClientId[remoteClientId]
            // }
            // else {
            //     console.log('[MASTER] handling SDP offer from existing client:', remoteClientId)
            //     peerConnection = this.peerConnectionByClientId[remoteClientId]
            // }

            await peerConnection.setRemoteDescription(offer); // (4) set remote desc 
            this.log('[VIEWER] set remote description')
            await peerConnection.setLocalDescription( // (6) // set local dsc
                await peerConnection.createAnswer({ // (5) Create an SDP answer to send back to the client
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: true,
                })
            )
            this.log('[VIEWER] created SDP answer')
            this.log('[VIEWER] set local description')

            // When trickle ICE is enabled, send the answer now and then send ICE candidates as they are generated. Otherwise wait on the ICE candidates.
            if (useTrickleICE) {
                console.log('[MASTER] Sending SDP answer to client: ' + remoteClientId);
                this.signalingClient.sendSdpAnswer(peerConnection.localDescription, remoteClientId); // (7) send the local desc, which was set to the sdp answer, back to the sender
                this.log('[VIEWER] send SDP answer')
            }

        });
    
        peerConnection.oniceconnectionstatechange = ()=>{
            console.log('new connection state:', peerConnection.iceConnectionState)
            this.log(`ice connection state changed to ${peerConnection.iceConnectionState}`)
            if (peerConnection.iceConnectionState == 'disconnected') {
                console.log('master being viewed disconnected')
                // peerConnection.close()
                this.setStreams([], this.channelName)
            }
        }

        // Poll for connection stats
        // this.peerConnectionStatsInterval = setInterval(() => peerConnection.getStats().then((stats)=>{console.log(`stats report from ${this.channelName}:`, stats)}), 60000)

        this.signalingClient.on('open', async () => {
            console.log('[VIEWER] Connected to signaling service');
            this.log('[VIEWER] opened signaling client')
            // Create an SDP offer to send to the master
            // console.log('[VIEWER] Creating SDP offer');
            await peerConnection.setLocalDescription(
                await peerConnection.createOffer({
                    offerToReceiveAudio: true,
                    // offerToReceiveAudio: false,
                    offerToReceiveVideo: true,
                }),
            );
            this.log('[VIEWER] created SDP offer')
            this.log('[VIEWER] set local description')

            // When trickle ICE is enabled, send the offer now and then send ICE candidates as they are generated. Otherwise wait on the ICE candidates.
            if (useTrickleICE) {
                // console.log('[VIEWER] Sending SDP offer');
                this.signalingClient.sendSdpOffer(peerConnection.localDescription);
                this.log('[VIEWER] sent sdp offer')
                
            }
            // console.log('[VIEWER] Generating ICE candidates');
        });

        this.signalingClient.on('sdpAnswer', async answer => {
            // Add the SDP answer to the peer connection
            // console.log('[VIEWER] Received SDP answer');
            // alert('sdp ans')
            this.log('[VIEWER] received SDP answer')
            await peerConnection.setRemoteDescription(answer);
        });

        this.signalingClient.on('iceCandidate', candidate => {
            // Add the ICE candidate received from the MASTER to the peer connection
            // console.log('[VIEWER] Received ICE candidate');
            peerConnection.addIceCandidate(candidate);
        });

        this.signalingClient.on('close', () => {
            console.log('[VIEWER] Disconnected from signaling channel');
            this.log('[VIEWER] signaling channel closed')
        });

        this.signalingClient.on('error', error => {
            console.error('[VIEWER] Signaling client error: ', error);
        });


        // Send any ICE candidates to the other peer
        peerConnection.addEventListener('icecandidate', ({ candidate }) => {
            if (candidate) {
                // console.log('[VIEWER] Generated ICE candidate');

                // When trickle ICE is enabled, send the ICE candidates as they are generated.
                if (useTrickleICE) {
                    // console.log('[VIEWER] Sending ICE candidate');
                    try {
                        this.signalingClient.sendIceCandidate(candidate);
                    }
                    catch (err) {
                        console.error('error in sending ice candidate')
                        console.error(err)
                    }
                }
            } else {
                // console.log('[VIEWER] All ICE candidates have been generated');

                // When trickle ICE is disabled, send the offer now that all the ICE candidates have ben generated.
                if (!useTrickleICE) {
                    // console.log('[VIEWER] Sending SDP offer');
                    this.signalingClient.sendSdpOffer(peerConnection.localDescription);
                }
            }
        });

        // As remote tracks are received, add them to the remote view
        peerConnection.addEventListener('track', event => {
            this.log('[VIEWER] received track')
            this.remoteStreams = [...this.remoteStreams, event.streams[0]]
            console.log(this.remoteStreams)
            this.setStreams(this.remoteStreams)
        })

        this.peerConnection = peerConnection

        peerConnection.onnegotiationneeded = async () => {
            console.log('[VIEWER] NEGOTIATION NEEDED')
            this.log('[VIEWER] negotiation needed')
            // Create an SDP offer to send to the master
            // renegotiate
            await peerConnection.setLocalDescription(
                await peerConnection.createOffer({
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: true,
                }),
            );
            this.log('[VIEWER] created SDP offer')
            this.log('[VIEWER] set local description')
            try { 
                this.signalingClient.sendSdpOffer(peerConnection.localDescription);
                this.log('[VIEWER] sent sdp offer')
                // alert('success sending sdp')
            }
            catch{
                this.log('[VIEWER] error sending SDP offer')
                // alert('error sending sdp')

            }
            // alert('negotiation needed')
        }

    }

    stopViewer = () => {
        console.log('[VIEWER] Stopping viewer connection');
        if (this.signalingClient) {
            this.signalingClient.close();
            this.signalingClient = null;
        }

        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        if (this.localScreen) {
            this.localScreen.getTracks().forEach(track => track.stop());
            this.localScreen = null
        }

        if (this.remoteStream) {
            this.remoteStream.getTracks().forEach(track => track.stop());
            this.remoteStream = null;
        }

        if (this.peerConnectionStatsInterval) {
            clearInterval(this.peerConnectionStatsInterval);
            this.peerConnectionStatsInterval = null;
        }

        this.log('[VIEWER] stopped')

        // if (this.state.localView) {
        //     this.setState({localView.srcObject = null;
        // }

        // if (this.state.remoteView) {
        //     this.state.remoteView.srcObject = null;
        // }

        // if (this.state.dataChannel) {
        //     this.state.dataChannel = null;
        // }
    }

    sendViewerMessage = (message) => {
        if (this.dataChannel) {
            try {
                this.dataChannel.send(message);
                alert('sending message:', message)
            } catch (e) {
                console.error('[VIEWER] failed to send message:', message)
                console.error('[VIEWER] error:', e.toString());
            }
        }
    }

    // toggleMedia(stream, type) {
    //     const senders
    //     if stream
    //     if (type == 'webcam') {

    //     }
    // }

    // toggleWebcam = async (localStream) => {
    //     console.log('toggling webcam')
    //     if (localStream) { // if stream given, then this must be an indication to start sharing the webcam
    //         console.log('starting webcam share')
    //         var senders = localStream.getTracks().map(track => {
    //             console.log('adding track:', track)
    //             return this.peerConnection.addTrack(track, this.state.localStream)
    //         })
    //         this.webcam_track_senders = senders
    //         this.sharing_webcam = true
    //         console.log('webcam senders:', this.webcam_track_senders)
    //     }
    //     else {
    //         console.log('stopping webcam share')
    //         console.log('current senders:', this.webcam_track_senders)
    //         await this.webcam_track_senders.forEach((sender)=>{this.peerConnection.removeTrack(sender)}) // specify the sender of the track (for the screenshare) and remove it from the RTCPeerConnection
    //         this.sharing_webcam = !this.sharing_webcam
    //         this.localStream = null
    //         this.webcam_track_senders = null
    //     }
    // }

    // toggleScreenshare = async (localScreen) => {
    //     console.log('toggling screenshare')
    //     console.log('sharing screen?', this.sharing_screen)
    //     // if (this.sharing_screen) {
    //     //     console.log(this.screen_track_senders)
    //     //     await this.screen_track_senders.forEach((sender)=>{this.peerConnection.removeTrack(sender)}) // specify the sender of the track (for the screenshare) and remove it from the RTCPeerConnection
    //     //     this.sharing_screen = !this.state.sharing_screen
    //     //     this.localScreen = null
    //     //     this.screen_track_senders = null
    //     // }
    //     // else {
    //     //     this.localScreen = await navigator.mediaDevices.getDisplayMedia(screenShareOptions)
    //     //     var senders = this.localScreen.getTracks().map(track => {return this.peerConnection.addTrack(track, this.localScreen)})
    //     //     this.screen_track_senders = senders
    //     //     this.sharing_screen = true
    //     // }
    // }    
}
