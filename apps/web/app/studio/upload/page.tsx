import { UploadForm } from './upload-form';
export default function UploadPage() {
  return (
    <>
      <h1>Upload a GIF</h1>
      <p>
        Your original stays in private quarantine. Receipt confirms storage
        only. Processing and publication have not started.
      </p>
      <UploadForm />
    </>
  );
}
