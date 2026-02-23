declare module 'pdf-parse' {
  type PdfParseResult = {
    text?: string;
  };

  function pdfParse(input: Buffer): Promise<PdfParseResult>;
  export default pdfParse;
}
