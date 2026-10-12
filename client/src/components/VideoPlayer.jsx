import React, { useContext, useEffect } from 'react';
import { Avatar, Typography } from '@material-ui/core';
import { VideocamOff } from '@material-ui/icons';

import { SocketContext } from '../Context';

const VideoPlayer = () => {
  const {
    name, callAccepted, myVideo, userVideo, callEnded, stream, remoteStream, call, mediaError,
  } = useContext(SocketContext);
  const isInCall = callAccepted && !callEnded;

  useEffect(() => {
    if (userVideo.current) {
      userVideo.current.srcObject = remoteStream || null;
    }
  }, [remoteStream, isInCall, userVideo]);

  return (
    <div className={`video-grid${isInCall ? ' in-call' : ''}`}>
      <article className={`video-tile local-tile${stream ? ' has-video' : ''}`}>
        {stream ? (
          <video playsInline muted ref={myVideo} autoPlay />
        ) : (
          <div className="video-placeholder">
            <Avatar className="placeholder-avatar">{name ? name.charAt(0).toUpperCase() : 'Y'}</Avatar>
            <Typography variant="h6">{mediaError ? 'Camera or microphone unavailable' : 'Camera and microphone are off'}</Typography>
            <p>{mediaError || 'They’re only requested when you start or answer a call.'}</p>
            <VideocamOff className="placeholder-icon" />
          </div>
        )}
        <div className="video-label">
          <span className="video-live-dot" />
          {name || 'You'} <span className="you-tag">You</span>
        </div>
      </article>

      {isInCall && (
        <article className="video-tile remote-tile">
          <video playsInline ref={userVideo} autoPlay />
          <div className="video-label">
            <span className="video-live-dot" />
            {call.name || 'Guest'}
          </div>
        </article>
      )}
    </div>
  );
};

export default VideoPlayer;
