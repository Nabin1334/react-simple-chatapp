/* eslint-env jest */

import React, { useContext } from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import Peer from 'simple-peer';
import { io } from 'socket.io-client';
import { ContextProvider, SocketContext } from './Context';

jest.mock('socket.io-client', () => ({
  io: jest.fn(() => ({
    on: jest.fn(),
    off: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
    emit: jest.fn(),
  })),
}));
jest.mock('simple-peer', () => jest.fn());

const CallControls = () => {
  const {
    callUser, leaveCall, mediaError, callError,
  } = useContext(SocketContext);
  return (
    <>
      <button type="button" onClick={() => callUser('peer-id')}>Start call</button>
      <button type="button" onClick={leaveCall}>End call</button>
      {(mediaError || callError) && <div role="alert">{mediaError || callError}</div>}
    </>
  );
};

describe('call media permissions', () => {
  let getUserMedia;
  let container;

  beforeEach(() => {
    jest.clearAllMocks();
    Peer.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    getUserMedia = jest.fn().mockRejectedValue(
      Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }),
    );
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
  });

  it('does not request camera or microphone until the user starts a call', async () => {
    act(() => {
      ReactDOM.render(
        <ContextProvider userName="Test User">
          <CallControls />
        </ContextProvider>,
        container,
      );
    });

    expect(getUserMedia).not.toHaveBeenCalled();

    act(() => {
      container.querySelector('button').click();
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: true });
    expect(container.querySelector('[role="alert"]').textContent).toContain('Camera and microphone access was not granted.');

    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });

  it('does not request camera or microphone when the signed-in screen is closed without a call', () => {
    act(() => {
      ReactDOM.render(
        <ContextProvider userName="Test User">
          <CallControls />
        </ContextProvider>,
        container,
      );
    });

    expect(getUserMedia).not.toHaveBeenCalled();

    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();

    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('stops a permission request that resolves after the user ends the call', async () => {
    let resolveMedia;
    getUserMedia.mockImplementation(() => new Promise((resolve) => {
      resolveMedia = resolve;
    }));

    act(() => {
      ReactDOM.render(
        <ContextProvider userName="Test User">
          <CallControls />
        </ContextProvider>,
        container,
      );
    });

    act(() => {
      container.querySelector('button').click();
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    act(() => {
      container.querySelectorAll('button')[1].click();
    });

    const track = { stop: jest.fn() };
    const lateStream = { getTracks: () => [track] };
    await act(async () => {
      resolveMedia(lateStream);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(Peer).not.toHaveBeenCalled();

    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });

  it('stops a permission request that resolves after the signed-in screen closes', async () => {
    let resolveMedia;
    getUserMedia.mockImplementation(() => new Promise((resolve) => {
      resolveMedia = resolve;
    }));

    act(() => {
      ReactDOM.render(
        <ContextProvider userName="Test User">
          <CallControls />
        </ContextProvider>,
        container,
      );
    });

    act(() => {
      container.querySelector('button').click();
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });

    const track = { stop: jest.fn() };
    const lateStream = { getTracks: () => [track] };
    await act(async () => {
      resolveMedia(lateStream);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(Peer).not.toHaveBeenCalled();
    container.remove();
  });

  it('ignores a permission denial that arrives after the user ends the call', async () => {
    let rejectMedia;
    getUserMedia.mockImplementation(() => new Promise((resolve, reject) => {
      rejectMedia = reject;
    }));

    act(() => {
      ReactDOM.render(
        <ContextProvider userName="Test User">
          <CallControls />
        </ContextProvider>,
        container,
      );
    });

    act(() => {
      container.querySelector('button').click();
    });
    act(() => {
      container.querySelectorAll('button')[1].click();
    });

    await act(async () => {
      rejectMedia(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(Peer).not.toHaveBeenCalled();

    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });

  it('stops local media and destroys the peer when signaling disconnects', async () => {
    const track = { stop: jest.fn() };
    const localStream = { getTracks: () => [track] };
    const peer = {
      on: jest.fn(),
      destroy: jest.fn(),
      signal: jest.fn(),
    };
    getUserMedia.mockResolvedValue(localStream);
    Peer.mockImplementation(() => peer);

    act(() => {
      ReactDOM.render(
        <ContextProvider userName="Test User">
          <CallControls />
        </ContextProvider>,
        container,
      );
    });

    act(() => {
      container.querySelector('button').click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const socket = io.mock.results[0].value;
    const disconnectHandler = socket.on.mock.calls.find(([event]) => event === 'disconnect')[1];
    act(() => disconnectHandler());

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(peer.destroy).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]').textContent).toContain('calling service disconnected');

    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });

  it('cleans up when the remote signaling response is invalid', async () => {
    const track = { stop: jest.fn() };
    const localStream = { getTracks: () => [track] };
    const peer = {
      on: jest.fn(),
      destroy: jest.fn(),
      signal: jest.fn(() => {
        throw new Error('Invalid peer signal');
      }),
    };
    getUserMedia.mockResolvedValue(localStream);
    Peer.mockImplementation(() => peer);

    act(() => {
      ReactDOM.render(
        <ContextProvider userName="Test User">
          <CallControls />
        </ContextProvider>,
        container,
      );
    });

    act(() => {
      container.querySelector('button').click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const socket = io.mock.results[0].value;
    const callAcceptedHandler = socket.on.mock.calls.find(([event]) => event === 'callAccepted')[1];
    act(() => callAcceptedHandler({ invalid: true }));

    expect(peer.destroy).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenCalledWith('callEnded');
    expect(container.querySelector('[role="alert"]').textContent).toContain('video connection could not be established');

    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });
});
