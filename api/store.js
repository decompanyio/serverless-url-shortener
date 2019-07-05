'use strict'

const url = require('url')
const config = require('../config.json')
const AWS = require('aws-sdk')
const S3 = new AWS.S3({region: config.REGION})
const dynamo = new AWS.DynamoDB({region: config.REGION})
const DYNAMO_TABLE = config.DYNAMO_TABLE;


module.exports.handle = (event, context, callback) => {
  const body = typeof(event.body)==='object'?event.body:JSON.parse(event.body);
  let longUrl = body.url || ''
 
  validate(longUrl)
    .then(function() {
      return getRedirectDynamo(longUrl);
    })
    .then(function(existShortUrl) {
      //console.log("existShortUrl", existShortUrl);
      if(existShortUrl){
        //let response = buildResponse(200, 'URL already created', existShortUrl.path)
        const response = {
          statusCode: 200,
          message: "URL already created",
          path: existShortUrl.path
        }
        return Promise.reject(response)
      } else {
        return getPath();
      }
    })
    .then(function (path) {
      console.log("path", path);
      let redirect = buildRedirect(path, longUrl)
      return saveRedirect(redirect)
    })
    .then(function (path) {
      let response = buildResponse(200, 'URL successfully shortened', path)
      return Promise.resolve(response)
    })
    .catch(function (err) {
      console.log("err", err);
      let response = buildResponse(err.statusCode, err.message, err.path)
      return Promise.resolve(response)
    })
    .then(function (response) {
      callback(null, response)
    })
    
}

function validate (longUrl) {
  if (longUrl === '') {
    return Promise.reject({
      statusCode: 400,
      message: 'URL is required'
    })
  }
  let parsedUrl = url.parse(longUrl)
  if (parsedUrl.protocol === null || parsedUrl.host === null) {
    return Promise.reject({
      statusCode: 400,
      message: 'URL is invalid'
    })
  }

  return Promise.resolve(longUrl)
}

function getPath () {
  return new Promise(function (resolve, reject) {
    let path = generatePath()
    isPathFree(path)
      .then(function (isFree) {
        return isFree ? resolve(path) : resolve(getPath())
      })
  })
}

function generatePath (path = '') {
  let characters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let position = Math.floor(Math.random() * characters.length)
  let character = characters.charAt(position)

  if (path.length === 7) {
    return path
  }

  return generatePath(path + character)
}

function isPathFree (path) {
  return S3.headObject(buildRedirect(path)).promise()
    .then(() => Promise.resolve(false))
    .catch((err) => err.code == 'NotFound' ? Promise.resolve(true) : Promise.reject(err))
}

function saveRedirect (redirect) {
  
  redirect['ContentType'] ='text/html;charset=utf-8';
  redirect['Body'] = Buffer.from(`<script>window.location.href = '${redirect.WebsiteRedirectLocation}'</script>`, 'binary');
  //console.log("saveRedirect", redirect);
  return saveRedirectDynamo(redirect).then(()=>S3.putObject(redirect).promise()
    .then(() => Promise.resolve(redirect['Key'])));
}

function saveRedirectDynamo(redirect) {
  return dynamo.putItem({
    TableName: DYNAMO_TABLE,
    ReturnConsumedCapacity: "TOTAL", 
    Item: {
      longUrl: {S: redirect.WebsiteRedirectLocation},
      path: {S: redirect.Key},
      created: {N: Date.now()+""}
    }
    
  }).promise();
   
}

function getRedirectDynamo(longUrl) {

  return new Promise((resolve, reject)=>{
    const params = {
      TableName: DYNAMO_TABLE,
      Key: {
        "longUrl": {S: longUrl}
      }
    };

    dynamo.getItem(params, function(err, data){
      if(err){
        reject(err);
      } else {
        //console.log("get query in dynamodb", data.Item);
        if(data.Item){
          resolve({longUrl: data.Item.longUrl.S, path: data.Item.path.S});
        } else {
          resolve(null);
        }
        
      }
    });
    
    return 
  })
  
   
}

function buildRedirect (path, longUrl = false) {
  let redirect = {
    'Bucket': config.BUCKET,
    'Key': path,
    
  }

  if (longUrl) {
    redirect['WebsiteRedirectLocation'] = longUrl;
  }

  return redirect
}

function buildRedirectUrl (path) {
  let baseUrl = `https://${config.BUCKET}.s3.${config.REGION}.amazonaws.com/`
  
  if ('BASE_URL' in config && config['BASE_URL'] !== '') {
    baseUrl = config['BASE_URL']
  }

  if(baseUrl.slice(-1) !== '/'){
    baseUrl += "/"
  }

  return baseUrl + path
}

function buildResponse (statusCode, message, path = false) {
  let body = { message }

  if (path) {
    body['path'] = path
    body['url'] = buildRedirectUrl(path)
  }

  return {
    headers: {
      'Access-Control-Allow-Origin': '*'
    },
    statusCode: statusCode,
    body: JSON.stringify(body)
  }
}
