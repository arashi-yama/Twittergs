class UtilProp{
  constructor(property,client){
    this.property=property
    this.key=`TwitterAPI_${client.clientId}_${client.serviceName}_${client.oauthVersion}`
  }

  getProperties(){
    return JSON.parse(this.property.getProperty(this.key))
  }

  setProperties(obj){
    obj={...this.getProperties(),...obj}
    this.property.setProperty(this.key,JSON.stringify(obj))
  }

  getProperty(key){
    return JSON.parse(this.property.getProperty(this.key))[key]
  }

  setProperty(key,value){
    this.property.setProperty(this.key,JSON.stringify({
      ...this.getProperties(),
      [key]:value
    }))
  }

  deleteProperty(key){
    let props=this.getProperties()
    let keys=Object.keys(props).filter(k=>k!==key)
    let obj={}
    for(let k of keys)obj[k]=props[k]
    this.property.setProperty(this.key,JSON.stringify(obj))
  }

  resetProperty(){
    this.property.setProperty(this.key,"{}")
  }
}