import React, { Component } from "react"
import { css, jsx } from "@emotion/core"
/** @jsx jsx */
// import { Button } from "mvp-webapp"
import { VideoOutput } from "./VideoOutput"
import Viewer from "./SignalingChannelViewer"
import Master from "./SignalingChannelMaster"
import Mbutton from '@material-ui/core/Button';
import { ButtonGroup, Button, } from '@material-ui/core';
import Box from '@material-ui/core/Box';
import { flexbox } from "@material-ui/system"

import { createMuiTheme, ThemeProvider } from '@material-ui/core/styles';
import blue from '@material-ui/core/colors/blue';

const theme = createMuiTheme({
  palette: {
    primary: {
        main: '#ff822e'
    },
    secondary: {
        main: '#18181b'
    }
  },
});

const style = css`
    video: height: 200px;
    background-color: var(--color2);
    height: 100%;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    margin: 20px;
    padding: 10px;
    color: black;

    .localstreams {
        video {
            height: 100px;
        }
    }

    .remotestreams {
        video {
            height: 100px;
        }

        .remotestream {
            // background-color: black;
            display: flex;
            flex-direction: column;
            border: 3px solid black;
        }
    }

    video {
        background-color: blue;

    }

    .btngroup {
        margin: 10px;
    }
`

const webcamOptions = {
        video: {
            width: { ideal : 320*2 },
            height: { ideal : 240*2 },
            mediaSource: "screen"
        },
        audio: true,
        audio: false,
}
const screenShareOptions = {
    video: {
        width: { ideal : 320*2*2 },
        height: { ideal : 240*2*2 },
        cursor: "always"
    },
    // audio: true
}

class User extends Component {
    constructor(props) {
        super(props)
        this.channel = `streamline-${this.props.idx}`
        this.id = `id-${this.props.idx}`
        this.state = {
            remoteStreams: {},
            viewers: {},
            webcam: null,
            sharing_webcam: false,
            sharing_screen: false,
        }
    }

    componentDidMount = async () => {
        try {
            this.setState({webcam: await navigator.mediaDevices.getUserMedia(webcamOptions)})
        }
        catch(err) {
            this.handleGetUserMediaError(err)
        }
    }

    startMaster = () => {
        this.setState({master: new Master(
            this.state.webcam,
            null,
            this.channel,
            (msg)=>{console.log('remote data msg:', msg)},
            report => {console.log('stats report:', report)},
            this.props.id,
            this.props.log
        )})
    }
    stopMaster = () => {
        this.state.master.stopMaster()
        var state = this.state
        delete state.master
        this.setState({...state})
    }

    addWebcam = () => {
        if (this.state.webcam) {
            this.state.master.toggleWebcam(this.state.webcam)
            this.setState({sharing_webcam: !this.state.sharing_webcam})
        }
        else {
            alert('please turn on the webcam first')
        }
    }
    removeWebcam = () => {
        this.state.master.toggleWebcam()
        this.setState({sharing_webcam: !this.state.sharing_webcam})
    }
    addScreenshare = () => {
        if (this.state.screenshare) {
            this.state.master.toggleScreenshare(this.state.screenshare)
            this.setState({sharing_screen: !this.state.sharing_screen})
        }
        else {
            alert('please turn on the screen first')
        }
    }
    removeScreenshare = () => {
        this.state.master.toggleScreenshare()
        this.setState({sharing_screen: !this.state.sharing_screen})
    }

    getScreenshare = async () => {
        var screenshare = await navigator.mediaDevices.getDisplayMedia(screenShareOptions)
        this.setState({screenshare})
    }

    setStreams = (streams , channel) => {
        console.log('got updated streams for channel:', channel, streams)
        this.setState({remoteStreams: {...this.state.remoteStreams, [channel]: streams}})
    }

    // toggleWebcam = async () => {
    //     if (this.state.webcam){
    //         this.master.toggleWebcam()
    //         this.setState({webcam: null})
    //         this.state.webcam.getTracks().forEach(track=>{
    //             track.stop()
    //         })
    //     }
    //     else {
    //         try {
    //             var webcam = await navigator.mediaDevices.getUserMedia(webcamOptions)
    //         }
    //         catch (err) {
    //             // handleGetUserMediaError(err)
    //         }
    //         this.master.toggleWebcam(webcam)
    //         this.setState({webcam})
    //     }
    // }
    // toggleScreenshare = async () => {
    //     if (this.state.screenshare){
    //         this.master.toggleScreenshare()
    //         this.setState({screenshare: null})
    //         this.state.screenshare.getTracks().forEach(track=>{
    //             track.stop()
    //         })
    //     }
    //     else {
    //         try {
    //             var screenshare = await navigator.mediaDevices.getDisplayMedia(screenShareOptions)
    //         }
    //         catch (err) {
    //             // handleGetUserMediaError(err)
    //         }
    //         this.master.toggleScreenshare(screenshare)
    //         this.setState({screenshare})
    //     }
    // }

    handleGetUserMediaError = (e) => {
        switch(e.name) {
            case "NotFoundError":
                alert("Unable to open your call because no camera and/or microphone" +
                    "were found.");
                break;
            case "SecurityError":
            case "PermissionDeniedError": // Do nothing; this is the same as the user canceling the call.
                break;
            default:
                alert("Error opening your camera and/or microphone: " + e.message);
                break
        }
    }

    connectTo = (channel) => {
        console.log('connecting to:', channel)
        this.setState({viewers: {
            ...this.state.viewers,
            [channel]: new Viewer(
                channel,
                (streams)=>{this.setStreams(streams, channel)},
                (msg)=>{console.log('remote data msg:', msg)},
                report => {console.log('stats report:', report)},
                `${this.props.id}s_VIEWER_of_${channel}`,
                // 'legend',
                this.props.log
            )
        }}, ()=>{
            console.log(this.id, this.viewers)
        })
    }

    disconnectFrom = (channel) => {
        var viewers = this.state.viewers
        viewers[channel].stopViewer()
        delete viewers[channel]
        var remoteStreams = this.state.remoteStreams
        if (remoteStreams[channel]) {
            delete remoteStreams[channel]
        }
        this.setState({viewers, remoteStreams}, ()=>{console.log(this.id, this.state.viewers)})
    }

    render() {
        return (
            <div css={css`${style}; background-color: ${colormap[this.props.idx]}`}>

                <div className="title">
                    {this.props.idx}
                    {this.state.channel}
                </div>
                <div className="localstreams">
                    {this.state.webcam?<VideoOutput video={this.state.webcam} muted={true}/>:null}
                    {this.state.screenshare?<VideoOutput video={this.state.screenshare} muted={true}/>:null}
                </div>
                <ButtonGroup color="secondary">
                    <Button variant="contained" disabled={this.state.screenshare}
                        onClick={this.state.screenshare?
                            null:
                            this.getScreenshare
                        }
                    >
                        {this.state.screenshare?"Already got screenshare":"Get screenshare"}

                    </Button>
                </ButtonGroup>

                <ButtonGroup color="secondary" variant="contained" className="btngroup">
                    <Button variant="contained" color="primary" 
                        onClick={this.state.master ? 
                            this.stopMaster:
                            this.startMaster}>
                        {this.state.master ?
                        'Stop master':
                        'Start master'
                        }
                    </Button>
                    <Button variant="contained" color="primary" disabled={!this.state.master}
                        onClick={this.state.sharing_webcam ? 
                            this.removeWebcam:
                            this.addWebcam}
                            >
                        {this.state.sharing_webcam ?
                        'Remove webcam':
                        'Add webcam'
                        }
                    </Button>
                    <Button variant="contained" color="primary"  disabled={!this.state.master}
                        onClick={this.state.sharing_screen? 
                            this.removeScreenshare:
                            this.addScreenshare}
                            >
                        {this.state.sharing_screen ?
                        'Stop screenshare':
                        'Start screenshare'
                        }
                    </Button>
                </ButtonGroup>
                {
                    this.props.connect_to.map(idx=>{
                        return <Button variant="contained"
                            onClick={()=>{
                                this.state.viewers[`streamline-${idx}`] ? 
                                this.disconnectFrom(`streamline-${idx}`): 
                                this.connectTo(`streamline-${idx}`) 
                            }} >
                            {this.state.viewers[`streamline-${idx}`] ? `Disconnect from ${idx}` : `Connect to ${idx}`}
                        </Button>
                    })
                }
                viewers: {JSON.stringify(Object.keys(this.state.viewers))}
                <br/>
                remoteStreams: {JSON.stringify(this.state.remoteStreams)}
                <div className="remotestreams">
                    {Object.keys(this.state.remoteStreams).map(channel=>{
                        return <div className="remotestream">
                            {channel}
                            {this.state.remoteStreams[channel].map(stream=>{return <VideoOutput video={stream}/>})}
                        </div>
                    })}
                </div>
            </div>

        )
    }
}

const container_style = css`


    .users {
        display: flex;
        flex-direction: row;
    }

    .log {
        background-color: #18181b;
        color: black;
        font-family: var(--font1);
        display: flex;
        flex-direction: column;
        align-items: center;
        min-width: 600px;
        height: 500px;
        overflow: auto;
        // overflow-y: auto;
        .title {
            font-size: 20px;
            font-weight: 1000;
        }
        .log-item {
            display: flex;
            justify-content: space-between;
            width: 90%;
            border: 2px solid #ff822e;
            
        }
    }
`

const user_idx = [
    1, 
    2,
    // 3, 
    // 4
]

const colormap = {
    1: '#f44336',
    2: '#009688',
    3: '#b388ff'
}

export default class UI extends Component {
    constructor(props) {
        super(props)
        this.state = {
            log: []
        }
    }

    log = (log_item) => {
        this.setState({log: [...this.state.log, log_item]})
    }

    render() {
        console.log(this.state.log)
        return (
            <ThemeProvider theme={theme} >
            <div css={container_style}>
                <div className="users">
                    {user_idx.map(idx=>{
                        return <User 
                            idx={idx} 
                            id={`id-${idx}`} 
                            log={this.log} 
                            connect_to={user_idx.filter(i=>{return i!=idx})} 
                            log={this.log} 
                        />})}                
                    <Box bgcolor="primary" color="primary" className="log">
                        <div className="title">
                            Logs
                        </div>
                        {this.state.log.map(l=>{
                            return <div className="log-item" css={css`background-color: ${colormap[l.id[3]]}`}>
                                <div>
                                    {l.id}
                                </div>
                                <div>
                                    {l.item}
                                </div>
                            </div>
                        })}
                    </Box>
                </div>
            </div>
            </ThemeProvider>
        )
    }
}
