import React, { useContext, useState } from 'react';
import { Button, TextField, Typography } from '@material-ui/core';
import { Assignment, Phone, PhoneDisabled } from '@material-ui/icons';
import { CopyToClipboard } from 'react-copy-to-clipboard';

import { SocketContext } from '../Context';

const Sidebar = () => {
  const {
    me, callAccepted, callPending, name, callEnded, leaveCall, callUser,
  } = useContext(SocketContext);
  const [idToCall, setIdToCall] = useState('');
  const isInCall = (callAccepted && !callEnded) || callPending;

  return (
    <aside className="control-panel">
      <section className="control-section">
        <Typography variant="h6" component="h2">Your details</Typography>
        <p className="section-copy">Your account name and personal call ID.</p>
        <TextField
          label="Signed-in name"
          value={name}
          fullWidth
          variant="outlined"
          margin="normal"
          autoComplete="name"
          disabled
        />
        <CopyToClipboard text={me}>
          <Button
            className="copy-button"
            variant="outlined"
            color="primary"
            fullWidth
            startIcon={<Assignment />}
            disabled={!me}
          >
            {me ? 'Copy my call ID' : 'Connecting to call service…'}
          </Button>
        </CopyToClipboard>
      </section>

      <div className="panel-divider" />

      <section className="control-section">
        <Typography variant="h6" component="h2">Join someone</Typography>
        <p className="section-copy">Paste their call ID to start a private call.</p>
        <TextField
          label="Call ID"
          value={idToCall}
          onChange={(event) => setIdToCall(event.target.value.trim())}
          fullWidth
          variant="outlined"
          margin="normal"
          autoComplete="off"
        />
        {isInCall ? (
          <Button
            className="call-button hangup-button"
            variant="contained"
            fullWidth
            startIcon={<PhoneDisabled />}
            onClick={leaveCall}
          >
            End call
          </Button>
        ) : (
          <Button
            className="call-button"
            variant="contained"
            color="primary"
            fullWidth
            startIcon={<Phone />}
            onClick={() => callUser(idToCall)}
            disabled={!me || !idToCall || callPending}
          >
            {callPending ? 'Starting call…' : 'Start call'}
          </Button>
        )}
      </section>
    </aside>
  );
};

export default Sidebar;
