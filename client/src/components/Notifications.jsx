import React, { useContext } from 'react';
import { Button } from '@material-ui/core';
import { Phone } from '@material-ui/icons';

import { SocketContext } from '../Context';

const Notifications = () => {
  const {
    answerCall, call, callAccepted, callPending,
  } = useContext(SocketContext);

  if (!call.isReceivingCall || callAccepted) {
    return null;
  }

  return (
    <div className="incoming-call" role="status">
      <div>
        <span className="incoming-eyebrow">Incoming call</span>
        <strong>{call.name || 'Someone'} is calling you</strong>
      </div>
      <Button variant="contained" color="primary" startIcon={<Phone />} onClick={answerCall} disabled={callPending}>
        {callPending ? 'Connecting…' : 'Answer'}
      </Button>
    </div>
  );
};

export default Notifications;
