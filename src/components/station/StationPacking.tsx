'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { 
  Search, 
  Camera as CameraIcon, 
  Check, 
  X, 
  Package, 
  Loader2
} from '../Icons';
import { motion, AnimatePresence } from 'framer-motion';

interface StationPackingProps {
    packerId: string;
    onPacked: () => void;
    todayCount: number;
    goal: number;
}

type CameraMode = 'off' | 'scanning' | 'photo';

export default function StationPacking({ packerId, onPacked, todayCount, goal }: StationPackingProps) {
    const [cameraMode, setCameraMode] = useState<CameraMode>('off');
    const [scannedTracking, setScannedTracking] = useState('');
    const [photos, setPhotos] = useState<string[]>([]);
    const [showDetails, setShowDetails] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    
    const scannerRef = useRef<Html5Qrcode | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const mockDetails = {
        productTitle: 'Sony Alpha a7 IV Mirrorless Camera',
        boxSize: '12x12x12',
        instructions: 'Fragile. Wrap in double bubble wrap. Use heavy duty tape.',
        shippingMethod: 'UPS Ground',
        customer: 'John Doe',
        destination: '123 Main St, Brooklyn, NY 11201'
    };

    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 1024);
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => {
            window.removeEventListener('resize', checkMobile);
            if (scannerRef.current) {
                scannerRef.current.stop().catch(console.error);
            }
        };
    }, []);

    const getCarrier = (tracking: string) => {
        const t = tracking.trim().toUpperCase();
        if (/^1Z[A-Z0-9]{16}$/.test(t)) return 'UPS';
        if (/^(94|93|92|91|420|04)\d{20,22}$/.test(t) || /^\d{20,22}$/.test(t)) return 'USPS';
        if (/^\d{12}$|^\d{15}$/.test(t)) return 'FedEx';
        return 'Unknown';
    };

    const startScanning = async () => {
        if (scannerRef.current) {
            try { await scannerRef.current.stop(); } catch (e) {}
            scannerRef.current = null;
        }
        setCameraMode('scanning');
        setShowDetails(false);
        setPhotos([]);
        setScannedTracking('');
        setTimeout(async () => {
            try {
                const element = document.getElementById("reader");
                if (!element) return;
                const html5QrCode = new Html5Qrcode("reader");
                scannerRef.current = html5QrCode;
                await html5QrCode.start(
                    { facingMode: "environment" },
                    { 
                        fps: 20,
                        qrbox: (viewfinderWidth, viewfinderHeight) => {
                            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                            return { width: minEdge * 0.8, height: minEdge * 0.4 };
                        },
                        aspectRatio: 1.0
                    },
                    (decodedText) => {
                        setScannedTracking(decodedText);
                        stopScanning();
                        setCameraMode('photo');
                        startCameraForPhoto();
                    },
                    (errorMessage) => {}
                );
            } catch (err) {
                console.error("Failed to start scanner:", err);
                if (scannerRef.current) {
                    try { await scannerRef.current.stop(); } catch (e) {}
                    scannerRef.current = null;
                }
                setTimeout(startScanning, 800);
            }
        }, 400);
    };

    const stopScanning = async () => {
        if (scannerRef.current) {
            try { await scannerRef.current.stop(); scannerRef.current = null; } catch (err) {}
        }
    };

    const startCameraForPhoto = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            if (videoRef.current) videoRef.current.srcObject = stream;
        } catch (err) { console.error(err); }
    };

    const takePhoto = () => {
        if (videoRef.current && canvasRef.current) {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(video, 0, 0);
            setPhotos(prev => [...prev, canvas.toDataURL('image/jpeg')]);
        }
    };

    const finishPacking = async () => {
        if (videoRef.current?.srcObject) {
            (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
        }
        if (scannedTracking) {
            try {
                const now = new Date();
                await fetch('/api/packing-logs', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        trackingNumber: scannedTracking,
                        photos: photos,
                        packerId: packerId,
                        boxSize: mockDetails.boxSize,
                        carrier: getCarrier(scannedTracking),
                        timestamp: now.toISOString(),
                        product: mockDetails.productTitle
                    })
                });
                onPacked();
            } catch (err) {}
        }
        setCameraMode('off');
        setShowDetails(true);
    };

    if (!isMobile) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12 bg-gray-50/30">
                <div className="max-w-md space-y-6">
                    <div className="w-20 h-20 bg-blue-50 rounded-3xl flex items-center justify-center mx-auto shadow-sm">
                        <Package className="w-10 h-10 text-blue-500" />
                    </div>
                    <div className="space-y-2">
                        <h2 className="text-2xl font-black text-gray-900 tracking-tighter">Review Mode</h2>
                        <p className="text-sm text-gray-500 leading-relaxed">
                            Station packing is only available on mobile devices. Use your phone to scan shipping labels and pack orders.
                        </p>
                    </div>
                    <div className="p-8 bg-white rounded-[2.5rem] border border-gray-100 shadow-sm space-y-4">
                        <div className="flex items-center justify-between px-2">
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Today's Progress</p>
                            <p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.2em]">{todayCount} / {goal}</p>
                        </div>
                        <div className="h-3 bg-gray-50 rounded-full overflow-hidden border border-gray-100 p-0.5">
                            <motion.div 
                                initial={{ width: 0 }} 
                                animate={{ width: `${Math.min((todayCount / goal) * 100, 100)}%` }} 
                                className="h-full bg-blue-500 rounded-full" 
                            />
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col relative overflow-hidden bg-white">
            <div className="flex-1 flex flex-col px-6 pt-6 overflow-y-auto no-scrollbar relative">
                <div className={`flex-1 flex flex-col space-y-8 ${(scannedTracking || showDetails) && cameraMode === 'off' ? 'pb-60' : 'pb-10'}`}>
                    {(scannedTracking || showDetails) && cameraMode === 'off' ? (
                        <div className="space-y-8">
                            <div className="text-center space-y-2">
                                <p className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em]">Product Info</p>
                                <h1 className="text-2xl font-black leading-tight text-gray-900 tracking-tighter">{mockDetails.productTitle}</h1>
                            </div>
                            
                            <div className="bg-gray-50 rounded-[2rem] p-6 border border-gray-100 space-y-4 shadow-sm">
                                <div className="flex items-center gap-3 border-b border-gray-200 pb-4">
                                    <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center border border-gray-100"><Search className="w-4 h-4 text-gray-400" /></div>
                                    <div><p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Customer</p><p className="text-sm font-bold text-gray-900">{mockDetails.customer}</p></div>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Address</p>
                                    <p className="text-sm font-medium text-gray-600 leading-relaxed">{mockDetails.destination}</p>
                                </div>
                            </div>
                            <div className="bg-blue-50 rounded-[2rem] p-6 border border-blue-100 space-y-3">
                                <div className="flex items-center gap-2 text-blue-500"><Check className="w-4 h-4" /><p className="text-[10px] font-black uppercase tracking-widest">How To Pack</p></div>
                                <p className="text-sm font-medium leading-relaxed text-blue-900">{mockDetails.instructions}</p>
                            </div>
                            <div className="bg-gray-50 rounded-3xl p-8 border-2 border-dashed border-gray-200 flex flex-col items-center justify-center gap-2 text-center">
                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Box Size</p>
                                <p className="text-4xl font-black text-gray-900 tracking-tighter">{mockDetails.boxSize}</p>
                            </div>
                            {photos.length > 0 && (
                                <div className="space-y-4">
                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-2">Photos ({photos.length})</p>
                                    <div className="flex gap-4 overflow-x-auto pb-4 px-2 no-scrollbar">
                                        {photos.map((photo, i) => (
                                            <div key={i} className="relative flex-shrink-0 shadow-sm rounded-2xl overflow-hidden border border-gray-200">
                                                <img src={photo} alt="" className="w-24 h-24 object-cover" />
                                                <button onClick={() => setPhotos(prev => prev.filter((_, idx) => idx !== i))} className="absolute top-1 right-1 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white shadow-lg"><X className="w-3 h-3" /></button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="flex justify-center items-center gap-4 pt-4 pb-10">
                                <button onClick={() => { setCameraMode('photo'); startCameraForPhoto(); }} className="h-16 px-8 bg-white border border-gray-100 rounded-2xl flex items-center gap-3 transition-all active:scale-95 group shadow-xl shadow-gray-200">
                                    <CameraIcon className="w-5 h-5 text-gray-400 group-hover:text-blue-500" />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 group-hover:text-gray-900">More</span>
                                </button>
                                <button onClick={() => { setScannedTracking(''); setPhotos([]); setShowDetails(false); startScanning(); }} className="h-16 px-8 bg-blue-600 rounded-2xl flex items-center gap-3 transition-all active:scale-95 shadow-xl shadow-blue-200 text-white font-black uppercase tracking-widest text-xs">
                                    <Search className="w-5 h-5" />
                                    New Scan
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-center space-y-12 py-12 min-h-[70vh]">
                            <div className="w-32 h-32 bg-gray-50 rounded-full flex items-center justify-center mx-auto relative border border-gray-100">
                                <div className="absolute inset-0 rounded-full border border-blue-100 animate-ping" />
                                <Package className="w-12 h-12 text-gray-300" />
                            </div>
                            
                            <div className="space-y-3">
                                <h1 className="text-3xl font-black text-gray-900 leading-tight tracking-tighter">Ready to begin</h1>
                                <p className="text-sm text-gray-500 max-w-xs mx-auto">Scan the shipping label to start</p>
                            </div>

                            <div className="w-full max-w-xs space-y-8">
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between px-2">
                                        <p className="text-[10px] font-black text-gray-400 whitespace-nowrap tabular-nums">{todayCount} PKG</p>
                                        <p className="text-[10px] font-black text-gray-400 whitespace-nowrap uppercase tracking-widest">Goal: {goal}</p>
                                    </div>
                                    <div className="h-3 bg-gray-50 rounded-full overflow-hidden border border-gray-100 p-0.5">
                                        <motion.div 
                                            initial={{ width: 0 }} 
                                            animate={{ width: `${Math.min((todayCount / goal) * 100, 100)}%` }} 
                                            className="h-full bg-blue-500 rounded-full shadow-lg shadow-blue-100" 
                                        />
                                    </div>
                                </div>

                                <div className="flex justify-center items-center gap-4 pt-8">
                                    <button onClick={startScanning} className="h-16 px-8 bg-white border border-gray-100 rounded-2xl flex items-center gap-3 transition-all active:scale-95 group shadow-xl shadow-gray-200">
                                        <CameraIcon className="w-5 h-5 text-gray-400 group-hover:text-blue-500" />
                                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 group-hover:text-gray-900">Camera</span>
                                    </button>
                                    <button onClick={() => { setScannedTracking(''); setPhotos([]); setShowDetails(false); startScanning(); }} className="h-16 px-8 bg-blue-600 rounded-2xl flex items-center gap-3 transition-all active:scale-95 shadow-xl shadow-blue-200 text-white font-black uppercase tracking-widest text-xs">
                                        <Search className="w-5 h-5" />
                                        New Scan
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <AnimatePresence>
                {cameraMode === 'scanning' && (
                    <motion.div key="scanner" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black z-[100] flex flex-col">
                        <div id="reader" className="absolute inset-0" />
                        <div className="absolute inset-0 border-4 border-blue-500/30 m-20 rounded-3xl animate-pulse pointer-events-none" />
                        <div className="absolute top-10 left-0 right-0 p-8 flex justify-between items-center z-[110]">
                            <div className="bg-black/40 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10"><p className="text-xs font-black uppercase tracking-widest text-white/80">Scanning...</p></div>
                            <button onClick={() => { stopScanning(); setCameraMode('off'); }} className="p-4 bg-black/40 backdrop-blur-md rounded-full text-white border border-white/10 active:scale-90"><X className="w-6 h-6" /></button>
                        </div>
                    </motion.div>
                )}
                {cameraMode === 'photo' && (
                    <motion.div key="camera" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black z-[100] flex flex-col">
                        <video ref={videoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
                        <canvas ref={canvasRef} className="hidden" />
                        <div className="absolute top-10 left-0 right-0 p-8 flex justify-between items-center z-[110]">
                            <div className="px-4 py-2 bg-black/50 backdrop-blur-md rounded-full border border-white/10 flex items-center gap-2"><div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" /><p className="text-[10px] font-black uppercase tracking-widest text-white/80">{scannedTracking}</p></div>
                            <div className="px-4 py-2 bg-blue-600 rounded-full text-[10px] font-black text-white shadow-lg">{photos.length} PHOTOS</div>
                        </div>
                        <div className="absolute bottom-12 left-0 right-0 px-10 flex justify-between items-center z-[110]">
                            <button onClick={finishPacking} className="h-16 px-8 bg-emerald-600 rounded-3xl flex items-center justify-center font-black text-xs uppercase tracking-widest hover:bg-emerald-500 active:scale-95 transition-all shadow-xl shadow-emerald-600/30 text-white">Done</button>
                            <div className="flex flex-col items-center gap-6">
                                <div className="px-5 py-2 bg-blue-600 rounded-2xl border border-white/20 shadow-2xl text-white"><p className="text-xs font-black uppercase tracking-widest">{mockDetails.boxSize}</p></div>
                                <button onClick={takePhoto} className="w-24 h-24 bg-white rounded-full flex items-center justify-center active:scale-90 transition-all shadow-[0_0_50px_rgba(255,255,255,0.3)] border-8 border-white/20"><div className="w-16 h-16 rounded-full border-4 border-gray-900 bg-white" /></button>
                            </div>
                            <div className="h-16 px-6 bg-white/10 backdrop-blur-xl rounded-3xl flex items-center justify-center border border-white/10 min-w-[140px] shadow-2xl text-white"><p className="font-mono text-sm font-bold tracking-wider">...{scannedTracking.slice(-6)}</p></div>
                        </div>
                    </motion.div>
                )}
                </AnimatePresence>
            </div>
        </div>
    );
}
