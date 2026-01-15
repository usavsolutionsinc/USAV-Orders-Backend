'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { 
  Search, 
  Camera as CameraIcon, 
  Check, 
  X, 
  Package, 
  Loader2,
  ChevronLeft
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

    const [orderDetails, setOrderDetails] = useState<any>(null);
    const [galleryOpen, setGalleryOpen] = useState(false);
    const [tempPhotos, setTempPhotos] = useState<string[]>([]);
    
    const mockDetails = {
        productTitle: 'Sony Alpha a7 IV Mirrorless Camera',
        orderId: 'ORD-7721',
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
                        fps: 30,
                        qrbox: (viewfinderWidth, viewfinderHeight) => {
                            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                            return { width: minEdge * 0.8, height: minEdge * 0.4 };
                        },
                        aspectRatio: 1.0,
                        disableFlip: true,
                        // High resolution preference without strict constraints
                        videoConstraints: {
                            facingMode: "environment",
                            width: { ideal: 1920 },
                            height: { ideal: 1080 }
                        }
                    },
                    async (decodedText) => {
                        // Resilient scanning: Only allow alphanumeric uppercase, no symbols
                        const cleanedText = decodedText.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                        
                        // If it's empty after cleaning or looks suspicious, don't proceed
                        if (!cleanedText || cleanedText.length < 10) {
                            console.log('Invalid scan detected, skipping:', decodedText);
                            return; // Don't stop scanning, let it try again
                        }

                        await stopScanning();
                        setScannedTracking(cleanedText);
                        
                        // Fetch order details from shipped table
                        try {
                            const res = await fetch(`/api/packing-logs/details?tracking=${encodeURIComponent(cleanedText)}`);
                            if (res.ok) {
                                const data = await res.json();
                                if (data.found) {
                                    setOrderDetails(data);
                                    setCameraMode('photo');
                                    startCameraForPhoto();
                                } else {
                                    console.log('Tracking not found in shipped sheet:', cleanedText);
                                    // Resume scanning since we stopped it
                                    startScanning();
                                }
                            } else {
                                // Error fetching details, resume scanning
                                startScanning();
                            }
                        } catch (e) {
                            console.error('Failed to fetch order details:', e);
                            startScanning();
                        }
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
            // First clear any existing stream
            if (videoRef.current?.srcObject) {
                (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
                videoRef.current.srcObject = null;
            }

            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { 
                    facingMode: 'environment',
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                } 
            });
            if (videoRef.current) videoRef.current.srcObject = stream;
        } catch (err) { 
            console.error("Failed to start photo camera:", err);
            // Fallback to basic constraints
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
                if (videoRef.current) videoRef.current.srcObject = stream;
            } catch (e) { console.error("Final fallback failed:", e); }
        }
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
            videoRef.current.srcObject = null;
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
                            orderId: orderDetails?.orderId || mockDetails.orderId,
                            boxSize: mockDetails.boxSize,
                            carrier: getCarrier(scannedTracking),
                            timestamp: now.toISOString(),
                            product: orderDetails?.productTitle || mockDetails.productTitle
                        })
                });
                onPacked();
            } catch (err) {}
        }
        setCameraMode('off');
        setShowDetails(true);
    };

    return (
        <div className="flex-1 flex flex-col relative bg-white min-h-0">
            {/* Minimal Progress Header */}
            <div className="px-4 py-3 border-b border-gray-100 bg-white sticky top-0 z-50">
                <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider">
                        {Math.round((todayCount / goal) * 100)}%
                    </p>
                    <p className="text-[10px] font-black text-gray-400 tabular-nums">
                        {Math.max(0, goal - todayCount)} remaining
                    </p>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <motion.div 
                        initial={{ width: 0 }} 
                        animate={{ width: `${Math.min((todayCount / goal) * 100, 100)}%` }} 
                        transition={{ duration: 0.5, ease: "easeOut" }}
                        className={`h-full rounded-full ${
                            todayCount >= goal ? 'bg-emerald-500' : 'bg-blue-500'
                        }`}
                    />
                </div>
            </div>

            <div className="flex-1 flex flex-col overflow-y-auto scrollbar-hide relative">
                <div className="flex-1 flex flex-col px-4 py-4 space-y-4">
                    {(scannedTracking || showDetails) && cameraMode === 'off' ? (
                        <div className="space-y-4 pb-20">
                            {/* Order ID and Box Size (Same Row) */}
                            <div className="flex items-baseline justify-between gap-4">
                                <h1 className="text-2xl font-black text-blue-600 tracking-tight">
                                    {orderDetails?.orderId || mockDetails.orderId}
                                </h1>
                                <p className="text-xl font-black text-gray-900 tracking-tight">
                                    {mockDetails.boxSize}
                                </p>
                            </div>

                            <p className="text-sm font-black leading-tight text-gray-900 tracking-tight -mt-2">
                                {orderDetails?.productTitle || mockDetails.productTitle}
                            </p>

                            {/* Frequently Missed Items Warning */}
                            <div className="bg-amber-50 rounded-2xl p-4 border border-amber-200">
                                <div className="flex items-center gap-2 text-amber-600 mb-2">
                                    <X className="w-4 h-4" />
                                    <p className="text-[10px] font-black uppercase tracking-widest">Frequently Missed Items</p>
                                </div>
                                <ul className="text-xs font-bold text-amber-900 space-y-1 ml-6 list-disc">
                                    <li>Power cables & adapters</li>
                                    <li>Remote controls</li>
                                    <li>Instruction manuals</li>
                                    <li>Small mounting screws</li>
                                </ul>
                            </div>

                            <div className="bg-blue-50 rounded-2xl p-4 border border-blue-100">
                                <div className="flex items-center gap-2 text-blue-500 mb-2">
                                    <Check className="w-3 h-3" />
                                    <p className="text-[9px] font-black uppercase tracking-widest">Instructions</p>
                                </div>
                                <p className="text-xs font-medium leading-relaxed text-blue-900">{mockDetails.instructions}</p>
                            </div>

                            {photos.length > 0 && (
                                <button 
                                    onClick={() => { setTempPhotos([...photos]); setGalleryOpen(true); }}
                                    className="w-full flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100 group active:scale-[0.98] transition-all"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-12 h-12 rounded-xl overflow-hidden border border-gray-200 bg-white">
                                            <img src={photos[photos.length - 1]} alt="" className="w-full h-full object-cover" />
                                        </div>
                                        <div className="text-left">
                                            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">View Photos</p>
                                            <p className="text-sm font-black text-gray-900">{photos.length} captured</p>
                                        </div>
                                    </div>
                                    <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center border border-gray-100 shadow-sm group-hover:border-blue-200 group-hover:text-blue-500 transition-all">
                                        <CameraIcon className="w-5 h-5" />
                                    </div>
                                </button>
                            )}

                            <div className="flex justify-center items-center gap-3 pt-4">
                                <button 
                                    onClick={() => { setCameraMode('photo'); startCameraForPhoto(); }} 
                                    className="flex-1 h-14 bg-white border-2 border-gray-200 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 shadow-sm"
                                >
                                    <CameraIcon className="w-4 h-4 text-gray-500" />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-700">Add Photo</span>
                                </button>
                                <button 
                                    onClick={() => { setScannedTracking(''); setPhotos([]); setShowDetails(false); startScanning(); }} 
                                    className="flex-1 h-14 bg-blue-600 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg shadow-blue-200 text-white"
                                >
                                    <Search className="w-4 h-4" />
                                    <span className="text-[10px] font-black uppercase tracking-widest">New Scan</span>
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
                                <div className="flex justify-center items-center gap-4">
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
                            <button onClick={async () => { await stopScanning(); setCameraMode('off'); }} className="p-4 bg-black/40 backdrop-blur-md rounded-full text-white border border-white/10 active:scale-90"><X className="w-6 h-6" /></button>
                        </div>
                    </motion.div>
                )}
                {cameraMode === 'photo' && (
                    <motion.div key="camera" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black z-[100] flex flex-col">
                        <video ref={videoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
                        <canvas ref={canvasRef} className="hidden" />
                        
                        {/* Top Bar */}
                        <div className="absolute top-8 left-0 right-0 px-6 flex justify-between items-center z-[110]">
                            <div className="px-3 py-1.5 bg-black/50 backdrop-blur-md rounded-full border border-white/10 flex items-center gap-2">
                                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                                <p className="text-[9px] font-black uppercase tracking-widest text-white/80">{scannedTracking}</p>
                            </div>
                            <div className="px-3 py-1.5 bg-blue-600 rounded-full text-[9px] font-black text-white shadow-lg">
                                {photos.length} PHOTOS
                            </div>
                            <button 
                                onClick={() => {
                                    if (videoRef.current?.srcObject) {
                                        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
                                        videoRef.current.srcObject = null;
                                    }
                                    setCameraMode('off');
                                    setShowDetails(true);
                                }} 
                                className="p-3 bg-black/40 backdrop-blur-md rounded-full text-white border border-white/10 active:scale-90"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Bottom Controls */}
                        <div className="absolute bottom-0 left-0 right-0 pb-safe z-[110]">
                            <div className="px-6 pb-8 flex justify-between items-end">
                                {/* Left: Box Size */}
                                <div className="flex flex-col items-start gap-3">
                                    <div className="px-4 py-2 bg-blue-600/90 backdrop-blur-md rounded-xl border border-white/20 shadow-2xl">
                                        <p className="text-[9px] font-black text-white/60 uppercase tracking-widest mb-0.5">Box</p>
                                        <p className="text-sm font-black text-white tracking-tight">{mockDetails.boxSize}</p>
                                    </div>
                                </div>
                                
                                {/* Center: Photo Button */}
                                <button 
                                    onClick={takePhoto} 
                                    className="w-20 h-20 bg-white rounded-full flex items-center justify-center active:scale-90 transition-all shadow-[0_0_50px_rgba(255,255,255,0.3)] border-4 border-white/20"
                                >
                                    <div className="w-14 h-14 rounded-full border-4 border-gray-900 bg-white" />
                                </button>
                                
                                {/* Right: Finish Button */}
                                <button 
                                    onClick={finishPacking} 
                                    className="w-16 h-16 bg-emerald-600 rounded-full flex items-center justify-center active:scale-90 transition-all shadow-xl shadow-emerald-600/30 text-white"
                                >
                                    <Check className="w-8 h-8" />
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}

                {galleryOpen && (
                    <motion.div 
                        initial={{ opacity: 0, y: 100 }} 
                        animate={{ opacity: 1, y: 0 }} 
                        exit={{ opacity: 0, y: 100 }} 
                        className="fixed inset-0 bg-black z-[200] flex flex-col"
                    >
                        <div className="flex-1 relative overflow-hidden flex items-center">
                            {photos.length === 0 ? (
                                <div className="w-full text-center text-white/40">
                                    <CameraIcon className="w-12 h-12 mx-auto mb-4 opacity-20" />
                                    <p className="text-xs font-black uppercase tracking-widest">No Photos</p>
                                </div>
                            ) : (
                                <div className="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide w-full h-[70vh] px-6 gap-6">
                                    {photos.map((photo, index) => (
                                        <div
                                            key={index}
                                            className="min-w-full h-full snap-center relative"
                                        >
                                            <div className="w-full h-full bg-gray-900 rounded-3xl overflow-hidden shadow-2xl border border-white/10 relative">
                                                <img src={photo} alt="" className="w-full h-full object-cover" />
                                                <div className="absolute top-6 left-6 flex items-center gap-3">
                                                    <div className="px-3 py-1 bg-black/50 backdrop-blur-md rounded-full border border-white/10">
                                                        <p className="text-[10px] font-black text-white/80 uppercase tracking-widest">
                                                            {index + 1} of {photos.length}
                                                        </p>
                                                    </div>
                                                    <div className="px-3 py-1 bg-blue-600/50 backdrop-blur-md rounded-full border border-blue-500/30">
                                                        <p className="text-[10px] font-black text-white uppercase tracking-widest">
                                                            {orderDetails?.orderId || mockDetails.orderId}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Gallery Controls */}
                        <div className="px-8 pb-12 flex justify-center items-center">
                            <button 
                                onClick={() => setGalleryOpen(false)}
                                className="w-20 h-20 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center text-white border border-white/10 active:scale-90 transition-all"
                            >
                                <ChevronLeft className="w-10 h-10" />
                            </button>
                        </div>
                    </motion.div>
                )}
                </AnimatePresence>
            </div>
        </div>
    );
}
