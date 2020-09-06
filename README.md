The UI shows 2 users, indicated by colored boxes. Each of them can start streaming from a Master by pressing `start master`. They can then add streams to any peerConnections made across the active signaling channel which they are streaming from. Initially no peerConnections have been made. Other users can connect to this signaling channel with Viewers and establish peerConnections.

## Description
Upon removing stream from established peerConnection, renegotiation is required, and attempted. This starts with the Master creating an SDP offer, setting it's local description equal to it, and then sending that SDP offer to the peer. 

### Expected behavior
Viewer receives SDP offer from master and completes negotiation. 

### Actual behaviour
Upon sending SDP offer to user 2's viewer (with clientId "id-2s_VIEWER_of_<CHANNEL_NAME>"), the Master immediately receives an SDP offer from a client with id "AWS_DEFAULT_SINGLE_MASTER". 

## Steps to reproduce current issues:

### SETUP
1. Pull this repo
2. add identity pool with kinesis permissions and user pool to Amplify configuration in App.js
3. Create some signaling channels called "streamline-1" and "streamline-2" in kinesis video streams
3. run `npm install` followed by `npm start`

### AFTER
1. Start user 1's master.
2. Add webcam to that stream
3. User 2 connects to user 1 (click `connect to `)
4. User 1 removes webcam from that peerConnection

## Checks
Upon connecting user 2's viewer to user 1 you should see the webcam feed of yourself appear in a new box at the bottom of user 2



