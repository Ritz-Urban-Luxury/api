import { validate } from 'class-validator';
import { FileUploadDTO, FileUploadPurpose } from './file-upload.dto';

const makeUpload = (data: string, purpose?: FileUploadPurpose) => {
  const upload = new FileUploadDTO();
  upload.data = data;
  upload.filename = 'test-file';
  upload.purpose = purpose;
  return upload;
};

describe('FileUploadDTO', () => {
  it('accepts JPEG images without an upload purpose', async () => {
    const errors = await validate(
      makeUpload('data:image/jpeg;base64,aGVsbG8='),
    );

    expect(errors).toHaveLength(0);
  });

  it('accepts PDFs for driver licence uploads', async () => {
    const errors = await validate(
      makeUpload(
        'data:application/pdf;base64,JVBERi0xLjQ=',
        FileUploadPurpose.DriverLicense,
      ),
    );

    expect(errors).toHaveLength(0);
  });

  it('rejects PDFs for ordinary uploads', async () => {
    const errors = await validate(
      makeUpload('data:application/pdf;base64,JVBERi0xLjQ='),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('data');
  });
});
