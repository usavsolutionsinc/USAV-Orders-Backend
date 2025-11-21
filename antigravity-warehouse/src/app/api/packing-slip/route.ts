import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const orderId = searchParams.get('orderId');

    // In a real app, generate a PDF here. 
    // For now, we'll return a redirect to a dummy PDF or serve a generated one.
    // Since QZ Tray expects a PDF URL or Base64, let's return a dummy PDF URL for this demo.

    return NextResponse.redirect('https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf');
}
