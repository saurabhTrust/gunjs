const forge = require('node-forge');
const fs = require('fs');
const path = require('path');

function generateCertificates() {
  // Generate a new key pair
  const keys = forge.pki.rsa.generateKeyPair(2048);

  // Create a new certificate
  const cert = forge.pki.createCertificate();

  // Set the certificate details
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  const attrs = [{
    name: 'commonName',
    value: 'localhost'
  }, {
    name: 'countryName',
    value: 'US'
  }, {
    shortName: 'ST',
    value: 'Virginia'
  }, {
    name: 'localityName',
    value: 'Blacksburg'
  }, {
    name: 'organizationName',
    value: 'Test'
  }, {
    shortName: 'OU',
    value: 'Test'
  }];

  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  // Sign the certificate
  cert.sign(keys.privateKey);

  // Convert to PEM format
  const pemCert = forge.pki.certificateToPem(cert);
  const pemKey = forge.pki.privateKeyToPem(keys.privateKey);

  // Write to files
  fs.writeFileSync(path.join(__dirname, 'cert.pem'), pemCert);
  fs.writeFileSync(path.join(__dirname, 'key.pem'), pemKey);

  console.log('Certificates generated successfully.');
}

generateCertificates();