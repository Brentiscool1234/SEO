import { NextRequest, NextResponse } from "next/server";
import axios from "axios";

export async function POST(req: NextRequest) {
  const { login, password } = await req.json();
  if (!login || !password) return NextResponse.json({ error: "Missing credentials" }, { status: 400 });

  const auth = Buffer.from(`${login}:${password}`).toString("base64");

  try {
    const res = await axios.get("https://api.dataforseo.com/v3/appendix/user_data", {
      headers: { Authorization: `Basic ${auth}` },
    });

    const data = res.data;
    const statusCode = data?.status_code;
    const statusMsg  = data?.status_message;

    if (statusCode && statusCode !== 20000) {
      return NextResponse.json({ ok: false, message: `${statusMsg} (code ${statusCode})`, raw: data });
    }

    const info = data?.tasks?.[0]?.result?.[0];
    return NextResponse.json({
      ok: true,
      email: info?.login ?? login,
      money: info?.money?.balance ?? null,
      currency: info?.money?.currency ?? null,
    });
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const body   = err.response?.data;
      const msg    = typeof body === "object"
        ? (body?.status_message ?? JSON.stringify(body))
        : String(body ?? err.message);
      return NextResponse.json({ ok: false, message: `HTTP ${status}: ${msg}`, raw: body }, { status: 200 });
    }
    return NextResponse.json({ ok: false, message: String(err) }, { status: 200 });
  }
}
