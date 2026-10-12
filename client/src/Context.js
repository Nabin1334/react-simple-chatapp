import React, { createContext, useState, useRef, useEffect } from 'react'; // React and its state hooks are imported so the app can manage live call data in a shared context.
import { io } from 'socket.io-client'; // The socket client is imported so the browser can talk to the Node.js signaling server.
import Peer from 'simple-peer'; // Simple Peer handles WebRTC connections for audio and video calls.

const SocketContext = createContext(); // A shared React context is created so all screens can access the call state and logic.

const socketUrl = process.env.REACT_APP_SOCKET_URL
  || (window.location.port === '3000' ? 'http://localhost:5000' : window.location.origin);
const socket = io(socketUrl, { // The app connects to the local development server or the server hosting the production build.
  transports: ['websocket'], // WebSocket transport is preferred because it is faster and more reliable for signaling than polling.
  reconnection: true, // The client should reconnect automatically if the network temporarily disappears.
  autoConnect: false,
  withCredentials: true,
});

const ContextProvider = ({ children, userName }) => { // The provider component wraps the app and exposes call-related state and methods to all descendants.
  const [callAccepted, setCallAccepted] = useState(false); // This flag indicates whether the current call has been accepted by the receiver.
  const [callPending, setCallPending] = useState(false);
  const [callEnded, setCallEnded] = useState(false); // This flag tells the UI that the current call has already ended.
  const [stream, setStream] = useState(null); // The local webcam and microphone stream is stored here so it can be shared with the peer.
  const [remoteStream, setRemoteStream] = useState(null);
  const [name] = useState(userName || ''); // The signed-in account name is displayed during calls.
  const [call, setCall] = useState({}); // Incoming call information such as caller ID, caller name, and offer signal is kept here.
  const [me, setMe] = useState(''); // The unique socket ID assigned by the signaling server is saved here.
  const [mediaError, setMediaError] = useState('');
  const [callError, setCallError] = useState('');

  const myVideo = useRef(null); // A reference to the local video element is created so we can attach the webcam stream.
  const userVideo = useRef(null); // A reference to the remote video element allows the remote stream to be displayed.
  const streamRef = useRef(null);
  const connectionRef = useRef(null); // The active WebRTC peer connection is stored so it can be ended cleanly later.
  const callAcceptedListenerRef = useRef(null); // This preserves the single accept-listener so a new call does not keep stacking duplicate handlers.
  const callAttemptRef = useRef(0);
  const callPendingRef = useRef(false);

  function stopLocalMedia() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setStream(null);
    }
  }

  function cancelCallAttempt() {
    callAttemptRef.current += 1;
    callPendingRef.current = false;
    setCallPending(false);
  }

  useEffect(() => { // This effect runs once when the provider mounts and sets up all media and socket listeners.
    const handleMe = (id) => { // This listener receives the current user's socket ID from the server.
      setMe(id); // The ID is stored so the user can share it to another caller.
      setCallError('');
    };

    const handleCallUser = ({ from, name: callerName, signal }) => { // When another user calls this browser, we store the details required to answer.
      cancelCallAttempt();
      setCallError('');
      setCallPending(false);
      setCall({ isReceivingCall: true, from, name: callerName, signal }); // The incoming call details are stored so the answer button can display.
    };

    const handleCallEnded = () => { // This listener is triggered when the other peer ends the call.
      cancelCallAttempt();
      setCallEnded(true); // The UI marks the call as ended.
      setCallAccepted(false); // The accepted status resets so the app returns to the idle view.
      setCallPending(false);
      setCall({}); // The call state is cleared so stale signal data does not remain in memory.

      if (connectionRef.current) { // If there is a live peer connection, it must be closed.
        connectionRef.current.destroy(); // The active WebRTC connection is destroyed to stop the media flow.
        connectionRef.current = null; // The old peer connection reference is cleared to prevent reuse.
      }

      stopLocalMedia();

      if (userVideo.current) {
        userVideo.current.srcObject = null;
      }
      setRemoteStream(null);

      if (callAcceptedListenerRef.current) {
        socket.off('callAccepted', callAcceptedListenerRef.current);
        callAcceptedListenerRef.current = null;
      }
    };

    const handleCallError = (message) => {
      cancelCallAttempt();
      setCallError(message);
      setCallPending(false);
      setCallAccepted(false);
      setCallEnded(true);
      if (connectionRef.current) {
        connectionRef.current.destroy();
        connectionRef.current = null;
      }
      stopLocalMedia();
      if (callAcceptedListenerRef.current) {
        socket.off('callAccepted', callAcceptedListenerRef.current);
        callAcceptedListenerRef.current = null;
      }
      setCall({});
      setRemoteStream(null);
    };

    const handleConnectError = () => {
      setCallError('Unable to connect to the calling service. Check your connection and try again.');
    };

    const handleDisconnect = () => {
      setMe('');
      cancelCallAttempt();
      setCall({});
      setCallAccepted(false);
      setCallEnded(true);
      setCallError('The calling service disconnected. Reconnect and start a new call.');
      if (connectionRef.current) {
        connectionRef.current.destroy();
        connectionRef.current = null;
      }
      stopLocalMedia();
      setRemoteStream(null);
      if (userVideo.current) {
        userVideo.current.srcObject = null;
      }
      if (callAcceptedListenerRef.current) {
        socket.off('callAccepted', callAcceptedListenerRef.current);
        callAcceptedListenerRef.current = null;
      }
    };

    socket.on('me', handleMe); // The server's 'me' event is listened to so the user ID is received.
    socket.on('callUser', handleCallUser); // The 'callUser' event is listened to so incoming calls can be answered.
    socket.on('callEnded', handleCallEnded); // The app listens for remote hang-up events and resets its UI and peer connection.
    socket.on('callError', handleCallError);
    socket.on('connect_error', handleConnectError);
    socket.on('disconnect', handleDisconnect);
    socket.connect();

    return () => { // Cleanup runs when the provider unmounts to avoid memory leaks and duplicate listeners.
      socket.off('me', handleMe); // The 'me' listener is removed.
      socket.off('callUser', handleCallUser); // The 'callUser' listener is removed.
      socket.off('callEnded', handleCallEnded); // The 'callEnded' listener is removed.
      socket.off('callError', handleCallError);
      socket.off('connect_error', handleConnectError);
      socket.off('disconnect', handleDisconnect);

      if (callAcceptedListenerRef.current) { // If a call-accepted listener was registered, it is also cleaned up.
        socket.off('callAccepted', callAcceptedListenerRef.current); // The accept event listener is removed to avoid duplicates after repeated calls.
      }
      callAttemptRef.current += 1;
      callPendingRef.current = false;
      socket.disconnect();
      if (connectionRef.current) {
        connectionRef.current.destroy();
        connectionRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  const getLocalStream = async (attempt) => {
    if (streamRef.current) {
      return streamRef.current;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const error = new Error('Camera and microphone access requires a supported browser and a secure connection (localhost is supported).');
      error.name = 'MediaAccessError';
      setMediaError(error.message);
      throw error;
    }

    try {
      const currentStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      return currentStream;
    } catch (error) {
      let message;
      switch (error.name) {
        case 'NotFoundError':
        case 'DevicesNotFoundError':
          message = 'No camera or microphone was found. Connect a device and try again.';
          break;
        case 'NotReadableError':
        case 'TrackStartError':
          message = 'Your camera or microphone is already in use. Close other apps using it and try again.';
          break;
        case 'NotAllowedError':
        case 'SecurityError':
          message = 'Camera and microphone access was not granted. Allow access in your browser settings, then try again.';
          break;
        case 'AbortError':
          message = 'The camera or microphone could not start. Please try again.';
          break;
        default:
          message = null;
      }
      if (!message) {
        throw error;
      }
      if (callAttemptRef.current === attempt) {
        setMediaError(message);
      }
      const mediaAccessError = new Error(message);
      mediaAccessError.name = 'MediaAccessError';
      throw mediaAccessError;
    }
  };

  useEffect(() => {
    if (stream && myVideo.current) {
      myVideo.current.srcObject = stream;
    }
  }, [stream]);

  const handlePeerError = (targetId) => {
    cancelCallAttempt();
    setCallError('The video connection could not be established. Please try calling again.');
    setCallAccepted(false);
    setCallPending(false);
    setCallEnded(true);
    if (targetId) {
      socket.emit('callEnded');
    }
    setCall({});
    setRemoteStream(null);
    if (connectionRef.current) {
      connectionRef.current.destroy();
      connectionRef.current = null;
    }
    if (callAcceptedListenerRef.current) {
      socket.off('callAccepted', callAcceptedListenerRef.current);
      callAcceptedListenerRef.current = null;
    }
    stopLocalMedia();
  };

  const answerCall = async () => { // This method accepts an incoming call after the receiver clicks the answer button.
    if (!call || !call.signal || !call.from || callPendingRef.current) {
      return;
    }

    const attempt = callAttemptRef.current + 1;
    callAttemptRef.current = attempt;
    callPendingRef.current = true;
    setCallError('');
    setMediaError('');
    setCallPending(true);

    try {
      const localStream = await getLocalStream(attempt);
      if (callAttemptRef.current !== attempt) {
        if (localStream !== streamRef.current) {
          localStream.getTracks().forEach((track) => track.stop());
        }
        return;
      }
      streamRef.current = localStream;
      setStream(localStream);
      setCallAccepted(true);
      callPendingRef.current = false;
      setCallPending(false);
      setCallEnded(false);

      const peer = new Peer({
        initiator: false,
        trickle: false,
        stream: localStream,
      });
      connectionRef.current = peer;

      peer.on('signal', (data) => {
        socket.emit('answerCall', { signal: data, to: call.from });
      });

      peer.on('stream', (currentStream) => {
        setRemoteStream(currentStream);
      });
      peer.on('error', () => handlePeerError(call.from));
      peer.on('error', () => handlePeerError(call.from));
      peer.signal(call.signal);
    } catch (error) {
      if (callAttemptRef.current === attempt) {
        callPendingRef.current = false;
        setCallPending(false);
        if (error.name !== 'MediaAccessError') {
          setCallAccepted(false);
          setCallEnded(true);
          setCall({});
          setCallError('Unable to answer the call. Please try again.');
          if (connectionRef.current) {
            connectionRef.current.destroy();
            connectionRef.current = null;
          }
          socket.emit('callEnded');
          stopLocalMedia();
        }
      }
    }
  };

  const callUser = async (id) => { // This start method initiates an outbound video/audio call to another user by socket ID.
    if (!id || callPendingRef.current || callAccepted) {
      return;
    }

    const attempt = callAttemptRef.current + 1;
    callAttemptRef.current = attempt;
    callPendingRef.current = true;
    setCallError('');
    setMediaError('');
    setCallEnded(false);
    setCallPending(true);
    setRemoteStream(null);
    setCall({ from: id, name: '' });

    try {
      const localStream = await getLocalStream(attempt);
      if (callAttemptRef.current !== attempt) {
        if (localStream !== streamRef.current) {
          localStream.getTracks().forEach((track) => track.stop());
        }
        return;
      }
      streamRef.current = localStream;
      setStream(localStream);
      const peer = new Peer({
        initiator: true,
        trickle: false,
        stream: localStream,
      });
      connectionRef.current = peer;

      peer.on('signal', (data) => {
        socket.emit('callUser', { userToCall: id, signalData: data });
      });

      peer.on('stream', (currentStream) => {
        setRemoteStream(currentStream);
      });
      peer.on('error', () => handlePeerError(id));

      if (callAcceptedListenerRef.current) {
        socket.off('callAccepted', callAcceptedListenerRef.current);
      }

      const handleCallAccepted = (signal) => {
        setCallAccepted(true);
        callPendingRef.current = false;
        setCallPending(false);
        setCallEnded(false);

        if (connectionRef.current) {
          try {
            connectionRef.current.signal(signal);
          } catch {
            handlePeerError(id);
          }
        }
      };

      callAcceptedListenerRef.current = handleCallAccepted;
      socket.on('callAccepted', handleCallAccepted);
    } catch (error) {
      if (callAttemptRef.current === attempt) {
        callPendingRef.current = false;
        setCallPending(false);
        setCallEnded(true);
        setCall({});
        if (error.name !== 'MediaAccessError') {
          setCallError('Unable to start the call. Please try again.');
          if (connectionRef.current) {
            connectionRef.current.destroy();
            connectionRef.current = null;
          }
          if (callAcceptedListenerRef.current) {
            socket.off('callAccepted', callAcceptedListenerRef.current);
            callAcceptedListenerRef.current = null;
          }
          socket.emit('callEnded');
          stopLocalMedia();
        }
      }
    }
  };

  const leaveCall = () => { // This method ends the current call and resets the UI and media state.
    const peerId = call.from;
    cancelCallAttempt();
    setCallEnded(true); // The app marks the call as ended so the hang-up UI can appear.
    setCallAccepted(false); // The UI is reset to the idle state.
    setCallPending(false);
    setCall({}); // The call object is cleared so stale signal data is not reused.

    if (callAcceptedListenerRef.current) { // If an accept listener exists, it should be removed before closing the call.
      socket.off('callAccepted', callAcceptedListenerRef.current); // The old listener is cancelled so no stale event remains attached.
      callAcceptedListenerRef.current = null; // The reference is cleared to prevent accidental reuse.
    }

    if (connectionRef.current) { // A peer connection is only destroyed if one was created.
      connectionRef.current.destroy(); // The active WebRTC connection is closed to end the audio and video stream.
      connectionRef.current = null; // The connection reference is reset to null after destruction.
    }

    stopLocalMedia();
    setMediaError('');

    if (peerId) { // If the peer who is in the call is known, the remote side is notified of the hang-up.
      socket.emit('callEnded', { to: peerId }); // A specific hang-up event is sent to the other participant.
    }

    if (userVideo.current) {
      userVideo.current.srcObject = null;
    }
    setRemoteStream(null);
  };

  return ( // The provider returns the context value that the rest of the app will use.
    <SocketContext.Provider value={{ // The call state and logic are passed to all child components through this value object.
      call,
      callAccepted,
      callPending,
      myVideo,
      userVideo,
      stream,
      remoteStream,
      mediaError,
      callError,
      name,
      callEnded,
      me,
      callUser,
      leaveCall,
      answerCall,
    }}
    >
      {children}
    </SocketContext.Provider>
  );
};

export { ContextProvider, SocketContext }; // The provider and context are exported so the app can use them in any component.
