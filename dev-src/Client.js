class Client{
  constructor({property=PropertiesService.getUserProperties(),CLIENT_ID=property.getProperty("CLIENT_ID"),CLIENT_SECRET=property.getProperty("CLIENT_SECRET"),API_KEY=property.getProperty("API_KEY"),API_SECRET=property.getProperty("API_SECRET"),serviceName,id,oauthVersion,ACCESS_TOKEN,ACCESS_TOKEN_SECRET,restTime=1000}={}){
    if(!oauthVersion)throw new Error("oauthVersionは必須です")
    if(!serviceName)throw new Error("serviceNameは必須です")
    this.serviceName=serviceName
    if(oauthVersion==="2.0"){
      this.oauthVersion="2.0"
    }else if(oauthVersion==="1.0a"){
      this.oauthVersion="1.0a"
    }else{
      throw new TypeError(`oauthVersionは"2.0"と"1.0a"のみ有効です`)
    }
    this.property=new Property(property,this)
    if(this.oauthVersion==="2.0"){
      if(!CLIENT_ID)throw new Error("oauthVersion2.0ではCLIENT_IDは必須です")
      if(!CLIENT_SECRET)throw new Error("oauthVersion2.0ではCLIENT_SECRETは必須です")
      this._refreshToken=this.property.getProperty("refresh_token")
      this.accessToken=this.property.getProperty("access_token")||ACCESS_TOKEN
      this.clientId=CLIENT_ID
      this.clientSecret=CLIENT_SECRET
      this.BASIC=Utilities.base64Encode(Util.parcentEncode(this.clientId)+":"+Util.parcentEncode(this.clientSecret))
      this.scope = this.property.getProperty("scope")
    }else{
      if(!API_KEY)throw new Error("oauthVersion1.0aではAPI_KEYは必須です")
      if(!API_SECRET)throw new Error("oauthVersion1.0aではAPI_SECRETは必須です")
      this.apiKey=API_KEY
      this.apiSecret=API_SECRET
      this.oauthToken=ACCESS_TOKEN||this.property.getProperty("oauth_token")
      this.oauthTokenSecret=ACCESS_TOKEN_SECRET||this.property.getProperty("oauth_token_secret")
      id=id||this.property.getProperty("user_id")
    }
    this.restTime=restTime
    if(id)this.user=new ClientUser(id,this)
  }

  setId(id){
    this.user=new ClientUser(id,this)
    return this
  }

  validate({scope,oauthVersion}={}){
    if(!oauthVersion.includes(this.oauthVersion))throw new Error(`${oauthVersion.join()}のみで使用可能です`)
    if(this.oauthVersion==="2.0"&&scope.length)scope.forEach(s=>{
      if(!this.scope?.includes(s))throw new Error(`${scope.filter(s=>!this.scope.includes(s))}スコープが不足しています`)
    })
  }
 
  authorize({scopes=TWITTER_API_DATA.scopes}={}){
    if(this.oauthVersion==="2.0"){
      const code_verifier=Client.makeNonce(32)
      const challenge=Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,code_verifier,Utilities.Charset.US_ASCII)).replace(/=/g,"")
      const state=ScriptApp.newStateToken()
        .withMethod("authCallBack")
        .withArgument("serviceName",this.serviceName)
        .withArgument("code_verifier",code_verifier)
        .createToken()
      this.property.setProperties({
        scope:scopes,
        code_verifier,
      })
      return `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${this.clientId}&redirect_uri=${Util.parcentEncode(Client.getCallBackURL())}&scope=${scopes.join("+")}&state=${state}&code_challenge=${challenge}&code_challenge_method=S256`
    }else{
      const state=ScriptApp.newStateToken()
        .withTimeout(3600)
        .withArgument("serviceName",this.serviceName)
        .withMethod("authCallBack")
        .createToken()
      this.oauthTokenSecret=null
      this.oauthToken=null
      const {oauth_token,oauth_token_secret}=this.fetch("https://api.twitter.com/oauth/request_token",{
        method:"POST",
        contentType:"application/x-www-form-urlencoded",
        payload:{
          oauth_callback:Client.getCallBackURL()+"?state="+state
        }
      })
      this.property.setProperty("oauth_token_secret",oauth_token_secret)
      return `https://api.twitter.com/oauth/authorize?oauth_token=${oauth_token}`
    }
  }

  static makeNonce(size=32){
    const chars="ABCDEFGHIDKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvxyz1234567890"
    return Array(size).fill(0).map(()=>chars[Math.floor(Math.random()*chars.length)]).join("")
  }
  
  _makeSignature({method,url,oauthParams}={}){
    let params=[]
    if(url.includes("?")){
      params=url.split("?")[1].split("&").map(v=>v.split("=")).map(([k,v])=>[k,decodeURIComponent(v)])
      url=url.split("?")[0]
    }

    params.push(...Object.entries(oauthParams))
    params.sort(([a],[b])=>(a>b)*2-1)

    const paramsResult=params.map(([key,value])=>`${Util.parcentEncode(key)}=${Util.parcentEncode(value)}`).join("&")
    const base=`${method}&${Util.parcentEncode(url)}&${Util.parcentEncode(paramsResult)}`
    const signing=`${Util.parcentEncode(this.apiSecret)}&${Util.parcentEncode(this.oauthTokenSecret||"")}`

    return Utilities.base64Encode(Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_1,base,signing))
  }

  static fixedEncodeURIComponent(str) {
    return encodeURIComponent(str).replace(/[!'()*]/g, function (c) {
      return '%' + c.charCodeAt(0).toString(16)
    })
  }

  static fromCallBackEvent({e,property=PropertiesService.getUserProperties(),CLIENT_ID=property.getProperty("CLIENT_ID"),CLIENT_SECRET=property.getProperty("CLIENT_SECRET"),API_KEY=property.getProperty("API_KEY"),API_SECRET=property.getProperty("API_SECRET")}={}){
    return new Client({
      serviceName:e.parameter.serviceName,
      oauthVersion:e.parameter.code?"2.0":"1.0a",
      API_KEY,
      API_SECRET,
      CLIENT_ID,
      CLIENT_SECRET
    })
  }
 
  isAuthorized(e){
    if(e.parameter.error)return false
    if(this.oauthVersion==="2.0"){
      const { code ,code_verifier} = e.parameter
      const { refresh_token, access_token,scope} = JSON.parse(UrlFetchApp.fetch("https://api.twitter.com/2/oauth2/token",{
        method:"POST",
        headers:{
          "Authorization":"Basic "+this.BASIC
        },
        payload:{
          grant_type:"authorization_code",
          code,
          code_verifier,
          redirect_uri:Client.getCallBackURL()
        }
      }))
      this.property.setProperties({
        refresh_token,
        access_token,
        scope:scope.split(" ")
      })
      return true
    }
    let {oauth_verifier,oauth_token}=e.parameter
    let response=Client.parseParam(UrlFetchApp.fetch("https://api.twitter.com/oauth/access_token",{
      method:"POST",
      payload:{
        oauth_consumer_key:this.apiKey,
        oauth_token,
        oauth_verifier
      }
    }).getContentText())
    const {oauth_token_secret,user_id}=response
    oauth_token=response.oauth_token
    this.property.setProperties({
      oauth_token,
      oauth_token_secret,
      user_id
    })
    return true
  }
 
  refresh(){
    this.validate({
      scope:["offline.access"],
      oauthVersion:["2.0"]
    })
    const options={
      method:"POST",
      headers:{
        "Authorization":"Basic "+this.BASIC
      },
      contentType:"application/x-www-form-urlencoded",
      payload:{
        grant_type:"refresh_token",
        refresh_token:this._refreshToken
      }
    }
    const response=JSON.parse(UrlFetchApp.fetch(`https://api.twitter.com/2/oauth2/token`,options))
    this._refreshToken=response.refresh_token
    this.accessToken=response.access_token
    this.property.setProperties({
      refresh_token:this._refreshToken,
      access_token:this.accessToken
    })
  }

  static refreshAll({CLIENT_ID,CLIENT_SECRET,serviceNames}={}){
    serviceNames.forEach((serviceName)=>{
      new Client({CLIENT_ID,CLIENT_SECRET,serviceName}).refresh()
    })
  }

  static getCallBackURL(){
    return `https://script.google.com/macros/d/${ScriptApp.getScriptId()}/usercallback`
  }

  fetch(url,options){
    if(this.oauthVersion==="2.0"){
      options.method=options.method?.toUpperCase()||"GET"
      if (!options) options = {}
      if (!options.headers)options.headers = { "Authorization": "Bearer " + this.accessToken }
      if (!options.headers.Authorization) options.headers.Authorization = "Bearer " + this.accessToken
      if (options.method==="POST"&&!options.contentType) throw new Error("contentTypeは必須です")
      if ((options.method === "GET") && options.queryParameters) {
        let uriOption=Client.buildParam(options.queryParameters)
        if(uriOption)url += "?" + uriOption
        delete options.queryParameters
      }
      Utilities.sleep(typeof this.restTime==="function"?Number(this.restTime()):Number(this.restTime))
      return JSON.parse(UrlFetchApp.fetch(url, options))
    }else{
      if(!options)options={}
      options.method=options.method?.toUpperCase()||"GET"
      if(!options.oauthParameters)options.oauthParameters={}
      if(this.oauthToken)options.oauthParameters.oauth_token=this.oauthToken
      if(options.method==="POST"&&!options.contentType)throw new Error("contentTypeは必須です")
      if ((options.method === "GET" || options.method === "get") && options.queryParameters) {
        let uriOption = Client.buildParam(options.queryParameters)
        if(uriOption)url += "?" + uriOption
        delete options.queryParameters
      }
      const oauthOptions={
        ...options.oauthParameters,
        oauth_consumer_key:this.apiKey,
        oauth_nonce:Client.makeNonce(),
        oauth_signature_method:"HMAC-SHA1",
        oauth_timestamp:Math.floor(Date.now()/1000)+"",
        oauth_version:"1.0"
      }
      if(options.contentType==="application/x-www-form-urlencoded"&&options.payload){
        url+=(url.includes("?")?"&":"?")+Client.buildParam(options.payload)
        oauthOptions.oauth_signature=this._makeSignature({method:options.method,url,oauthParams:oauthOptions})
        options.payload=url.split("?")[1]
        url=url.split("?")[0]
      }else{
        oauthOptions.oauth_signature=this._makeSignature({method:options.method,url,oauthParams:oauthOptions})
      }
      const authorizationString="OAuth "+Object.keys(oauthOptions).sort().map(key=>
        `${Util.parcentEncode(key)}="${Util.parcentEncode(oauthOptions[key])}"`
      ).join(", ")
      if(!options.headers)options.headers={}
      options.headers.Authorization=authorizationString
      delete options.oauthParameters
      if(options.contentType==="multipart/form-data")
        delete options.contentType
      Utilities.sleep(typeof this.restTime==="function"?Number(this.restTime()):Number(this.restTime))
      let response=UrlFetchApp.fetch(url,options)
      switch(response.getHeaders()["Content-Type"].split(";")[0]){
        case "application/json":return JSON.parse(response);break
        case "text/html":return Client.parseParam(response.getContentText());break
        default:return response
      }
    }
  }

  static buildParam(obj){
    let result=[]
    for(const key in obj){
      const value=Array.isArray(obj[key])?obj[key].join():obj[key]
      result.push(Util.parcentEncode(key)+"="+Util.parcentEncode(value))
    }
    return result.join("&")
  }

  static parseParam(str){
    if(str.includes("?"))str=str.split("?")[1]
    let params=str.split("&").map(v=>v.split("=").map(decodeURIComponent))
    const obj={}
    params.forEach(([key,value])=>obj[key]=value)
    return obj
  }
  
  hasAuthorized(){
    if(this.oauthVersion==="2.0")return !!this.accessToken
    return !!this.oauthToken
  }

  getTweets(queryParameters){
    if(this.oauthVersion==="2.0"){
      this.validate({
        oauthVersion:["2.0"],
        scope:["tweet.read","users.read"]
      })
      let response = this.fetch("https://api.twitter.com/2/tweets/search/recent", {
        queryParameters: queryParameters || Tweet.defaultQueryParameters,
      })
      return new WithMetaArray(response)
    }
    let response=this.fetch("https://api.twitter.com/1.1/search/tweets.json",{queryParameters})
    response.statuses=response.statuses.map(v=>new Tweet(v,this))
    return response
  }

  getTweetById(id,queryParameters){
    this.validate({
      oauthVersion:["1.0a","2.0"],
      scope:["tweet.read","users.read"]
    })
    let response=this.fetch(`https://api.twitter.com/2/tweets/${id}`,{
      queryParameters:queryParameters||Tweet.defaultQueryParameters
    })
    response.data=new Tweet(response.data,this)
    return response
  }

  getTweetByURL(url,queryParameters){
    return this.getTweetById(url.split("?")[0].split("/")[5],queryParameters)
  }

  postTweet(payload){
    this.validate({
      oauthVersion:["1.0a","2.0"],
      scope:["tweet.read","tweet.write","users.read"]
    })
    const option = {
      contentType:"application/json",
      method: "POST",
      payload: JSON.stringify(payload)
    }
    let response = this.fetch("https://api.twitter.com/2/tweets", option)
    return new Tweet(response.data, this)
  }

  getUserByUsername(username,queryParameters){
    this.validate({
      oauthVersion:["1.0a","2.0"],
      scope:["tweet.read","users.read"]
    })
    return new User(this.fetch(`https://api.twitter.com/2/users/by/username/${username}`,{queryParameters}).data,this)
  }
  
  getUsers(queryParameters){
    this.validate({
      oauthVersion:["1.0a"],
    })
    return this.fetch("https://api.twitter.com/1.1/users/search.json",{queryParameters}).map(v=>new User(v,this))
  }

  uploadMedia({fileName,blob}={}){
    this.validate({
      oauthVersion:["1.0a"]
    })
    let file
    if(fileName)file = DriveApp.getFilesByName(fileName).next()
    const data = Utilities.newBlob(
      (file?.getBlob() || blob).getBytes(),
      file?.getMimeType() || blob?.getContentType(),
      (file || blob).getName()
    )
    
    return this.fetch("https://upload.twitter.com/1.1/media/upload.json",{
      method:"post",
      contentType:"multipart/form-data",
      payload:{
        media:data,
      },
      muteHttpExceptions:true
    })
  }

  uploadBigMedia({fileName,blob}={}){
    this.validate({
      oauthVersion:["1.0a"]
    })
    if(!fileName&&!blob)throw new Error("fileNameかblobは必須です")
    let file
    if(fileName)file=fileName?DriveApp.getFilesByName(fileName).next():null
    const url="https://upload.twitter.com/1.1/media/upload.json"
    const name=blob?.getName()||file.getName()
    const mimeType=blob?.getContentType()||file.getMimeType()
    const {media_id_string}=this.fetch(url,{
      method:"POST",
      contentType:"application/x-www-form-urlencoded",
      payload:{
        command:"INIT",
        total_bytes:(blob?.getBytes()?.length||file.getSize())+"",
        media_type:mimeType,
      }
    })

    let mediaData=blob?.getBytes()||file.getBlob().getBytes()
    let segmentSize=5*1000*1000
    for(let i=0;i<Math.ceil(mediaData.length/segmentSize);i++){
      const blob = Utilities.newBlob(
        mediaData.slice(i*segmentSize,(i+1)*segmentSize),
        mimeType,
        name
      );
      this.fetch(url,{
        method:"POST",
        contentType:"multipart/form-data",
        payload:{
          command:"APPEND",
          media_id:media_id_string,
          media:blob,
          segment_index:i+""
        }
      })
    }

    return this.fetch(url,{
      method:"POST",
      contentType:"application/x-www-form-urlencoded",
      payload:{
        command:"FINALIZE",
        media_id:media_id_string
      }
    })
  }

  static getAuthorizedUsers(property=PropertiesService.getUserProperties()){
    let data=property.getKeys().filter(v=>v.startsWith("Twittergs_")).map(v=>v.split("_")).map(([_,version,...n])=>({version,n:n.join("_")}))
    return [
      data.filter(v=>v.version==="1.0a").map(v=>v.n).filter(serviceName=>new Client({serviceName,oauthVersion:"1.0a"}).hasAuthorized()),
      data.filter(v=>v.verison==="2.0").map(v=>v.n).filter(serviceName=>new Client({serviceName,oauthVersion:"1.0a"}).hasAuthorized())
    ]
  }
}


class AppOnlyClient{
  constructor(BEARER_TOKEN=PropertiesService.getUserProperties().getProperty("BEARER_TOKEN")){
    if(!BEARER_TOKEN)throw new Error("BEARER_TOKENは必須です")
    this.bearerToken=BEARER_TOKEN
  }
  fetch(url,options){
    options=options||{}
    options.headers=options.headers||{"Authorization":"Bearer "+this.bearerToken}
    if(options.queryParameters){
      let uriOption=[]
      for(const key in options.queryParameters){
        let value=options.queryParameters[key]
        if(Array.isArray(value))value=value.join(",")
        uriOption.push(`${key}=${Util.parcentEncode(value)}`)
      }
      url+="?"+uriOption.join("&")
      delete options.queryParameters
    }
    return JSON.parse(UrlFetchApp.fetch(url,options))
  }

  setClient(client){
    this.client=client
    return this
  }

  getTweets(queryParameters){
    let response=this.fetch("https://api.twitter.com/2/tweets/search/recent",{queryParameters})
    response.data=response.data.map(v=>new Tweet(v,this.client))
    return response
  }

  getTweetById(id,queryParameters){
    let response=this.fetch(`https://api.twitter.com/2/tweets/${id}`,{
      queryParameters:queryParameters||Tweet.defaultQueryParameters
    })
    response.data=new Tweet(response.data,this.client)
    return response
  }

  getUserByUsername(username,options){
    if(this.client)return new User(this.fetch(`https://api.twitter.com/2/users/by/username/${username}`,options).data,this.client)
    return this.fetch(`https://api.twitter.com/2/users/by/username/${username}`,options)
  }

  static getBearerToken(apiKey=PropertiesService.getUserProperties().getProperty("API_KEY"),apiSecret=PropertiesService.getUserProperties().getProperty("API_SECRET")){
    return JSON.parse(UrlFetchApp.fetch("https://api.twitter.com/oauth2/token",{    
      method: "POST",
      headers: {
        "Authorization": "Basic " + Utilities.base64Encode(apiKey+":"+apiSecret)
      },
      contentType:"application/x-www-form-urlencoded;charset=UTF-8",
      payload: {
        grant_type: "client_credentials"
      }
    })).access_token
  }
}