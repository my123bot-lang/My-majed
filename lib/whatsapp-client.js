/** مرجع عميل واتساب — للرد عند غياب msg.client */
let client = null;

function setWhatsAppClient(c) {
  client = c;
}

function getWhatsAppClient() {
  return client;
}

module.exports = { setWhatsAppClient, getWhatsAppClient };
