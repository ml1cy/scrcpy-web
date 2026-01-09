import React, { useEffect, useRef, useState } from 'react';
import { 
    Box, Button, CircularProgress, Typography, Paper, Alert,
    Stack
} from '@mui/material';
import { 
    ScrcpyOptions1_24, 
    ScrcpyOptions2_0, 
    ScrcpyOptions2_1,
    ScrcpyVideoCodecId,
    AdbScrcpyClient
} from "@yume-chan/scrcpy";
import { WebCodecsDecoder } from "@yume-chan/scrcpy-decoder-webcodecs";

// Using local public file to avoid CORS issues
const SCRCPY_SERVER_VERSION = "2.1";
const SERVER_URL = "/scrcpy-server.jar";

const ScrcpyView = ({ device }) => {
    const containerRef = useRef(null);
    const [status, setStatus] = useState('idle'); // idle, pushing, starting, running, error
    const [message, setMessage] = useState('');
    const clientRef = useRef(null);
    const decoderRef = useRef(null);

    const startScrcpy = async () => {
        if (!device || !device.adb) return;
        
        try {
            setStatus('pushing');
            setMessage(`Fetching scrcpy-server v${SCRCPY_SERVER_VERSION}...`);
            
            // 1. Fetch the server binary
            const response = await fetch(SERVER_URL);
            if (!response.ok) throw new Error("Failed to download scrcpy-server from GitHub");
            const serverBuffer = await response.arrayBuffer();
            
            setMessage("Pushing server to device...");
            
            // 2. Push to device
            // We use /data/local/tmp/scrcpy-server.jar
            const sync = await device.adb.sync();
            try {
                await sync.write({
                    filename: "/data/local/tmp/scrcpy-server.jar",
                    file: new Uint8Array(serverBuffer),
                });
            } finally {
                sync.dispose();
            }

            setStatus('starting');
            setMessage("Starting server...");

            // 3. Configure options
            const options = new ScrcpyOptions2_1({
                // Defaults
            });

            // 4. Start Server
            clientRef.current = await AdbScrcpyClient.start(
                device.adb,
                "/data/local/tmp/scrcpy-server.jar",
                SCRCPY_SERVER_VERSION,
                options
            );

            const { videoStream } = clientRef.current;
            
            if (videoStream) {
                // Initialize decoder
                const decoder = new WebCodecsDecoder(ScrcpyVideoCodecId.H264);
                decoderRef.current = decoder;
                
                // Append the decoder's canvas to our container
                if (containerRef.current) {
                    containerRef.current.innerHTML = ''; // Clear previous
                    const canvas = decoder.renderer;
                    canvas.style.width = '100%';
                    canvas.style.height = '100%';
                    canvas.style.objectFit = 'contain';
                    containerRef.current.appendChild(canvas);
                }

                setStatus('running');
                setMessage("Streaming...");
                
                // Pipe the stream to the decoder
                // videoStream is ReadableStream<ScrcpyMediaStreamPacket>
                // decoder.writable is WritableStream<ScrcpyMediaStreamPacket>
                videoStream.pipeTo(decoder.writable).catch(e => {
                    console.error("Stream ended or failed", e);
                    setStatus('idle');
                });
            }

        } catch (e) {
            console.error(e);
            setStatus('error');
            setMessage(e.message);
        }
    };

    const stopScrcpy = async () => {
        if (clientRef.current) {
            await clientRef.current.close();
            clientRef.current = null;
        }
        if (decoderRef.current) {
            decoderRef.current.dispose();
            decoderRef.current = null;
        }
        // Clear canvas
        if (containerRef.current) {
            containerRef.current.innerHTML = '';
        }

        setStatus('idle');
        setMessage("");
    };

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (clientRef.current) {
                clientRef.current.close(); 
            }
            if (decoderRef.current) {
                decoderRef.current.dispose();
            }
        };
    }, []);

    return (
        <Paper 
            elevation={3} 
            sx={{ 
                flexGrow: 1, 
                display: 'flex', 
                flexDirection: 'column', 
                overflow: 'hidden',
                bgcolor: 'background.paper',
                position: 'relative',
                minHeight: 500,
                borderRadius: 2
            }}
        >
            <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="h6">
                    Screen Control {status === 'running' && <Box component="span" sx={{ color: 'success.main', fontSize: '0.8em', ml: 1 }}>● LIVE</Box>}
                </Typography>
                <Box>
                    {status === 'idle' || status === 'error' ? (
                        <Button variant="contained" onClick={startScrcpy} disabled={status === 'pushing' || status === 'starting'}>
                            Start Stream
                        </Button>
                    ) : (
                        <Button variant="outlined" color="error" onClick={stopScrcpy}>
                            Stop
                        </Button>
                    )}
                </Box>
            </Box>

            <Box sx={{ 
                flexGrow: 1, 
                position: 'relative', 
                bgcolor: '#000', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                overflow: 'hidden'
            }}>
                {/* Status Overlay */}
                {status !== 'running' && status !== 'idle' && (
                  <Stack alignItems="center" spacing={2} sx={{ position: 'absolute', zIndex: 10 }}>
                     <CircularProgress color="primary" />
                     <Typography color="white">{message}</Typography>
                  </Stack>
                )}
                
                {status === 'error' && (
                    <Alert severity="error" sx={{ maxWidth: 400, position: 'absolute', zIndex: 10 }}>
                        {message}
                    </Alert>
                )}
                
                {status === 'idle' && (
                    <Box sx={{ textAlign: 'center', color: 'grey.600', p: 3 }}>
                       <Typography variant="h5">Ready to Connect</Typography>
                       <Typography variant="body2">Click "Start Stream" to begin</Typography>
                    </Box>
                )}

                {/* Video Container - The library appends a canvas here */}
                <div 
                    ref={containerRef} 
                    style={{ 
                        width: '100%', 
                        height: '100%', 
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }} 
                />
            </Box>
        </Paper>
    );
};

export default ScrcpyView;
