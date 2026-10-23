// Netlify Serverless Function: /api/network-info

exports.handler = async function(event, context) {
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      status: 'online',
      platform: 'Netlify Edge Cloud Serverless',
      webUrl: 'https://appllifymusic.netlify.app',
      publicUrl: 'https://appllifymusic.netlify.app'
    })
  };
};
