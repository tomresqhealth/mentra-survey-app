import { JWT } from "google-auth-library";
import fs from "fs";

const creds = JSON.parse(fs.readFileSync("service-account.json", "utf-8"));
const auth = new JWT({
  email: creds.client_email,
  key: creds.private_key,
  scopes: ["https://www.googleapis.com/auth/drive.file"],
  subject: "tom.elliott@resqware.solutions",
});

async function main() {
  await auth.authorize();
  console.log("✅ Auth successful");

  const folderId = "1JxG1VhyiaRRCckjAQ4wk_xEwL9aLkjtJ";
  const html = "<html><body><h1>Test Upload</h1><p>It works</p></body></html>";
  const boundary = "test_boundary";
  const metadata = JSON.stringify({
    name: "Test Upload - Delete Me",
    mimeType: "application/vnd.google-apps.document",
    parents: [folderId],
  });

  const body =
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: text/html\r\n\r\n${html}\r\n--${boundary}--`;

  const token = (await auth.getAccessToken()).token;
  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  if (!res.ok) {
    console.log("❌ Failed:", res.status, await res.text());
  } else {
    const r = (await res.json()) as { id: string };
    console.log(`✅ Uploaded: https://docs.google.com/document/d/${r.id}/edit`);
    console.log("🗑️ Delete 'Test Upload - Delete Me' from Drive when done.");
  }
}

main().catch((e) => console.error("❌", e.message));
