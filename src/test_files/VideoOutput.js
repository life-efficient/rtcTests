import React, { Component } from "react"

export class VideoOutput extends Component {
    constructor(props) {
        super(props);
        this.videoRef = React.createRef();
    }

    componentDidMount() {
        const videoObj = this.videoRef.current;
        videoObj.srcObject = this.props.video;
        videoObj.play()
        console.log(videoObj);
    }

    render() {
        return <video ref={this.videoRef} controls={false} muted={this.props.muted} autoPlay></video>;
    }
}
