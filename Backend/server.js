require("dotenv").config();
const dns=require("dns"), express=require("express"), mongoose=require("mongoose"), bcrypt=require("bcryptjs"), jwt=require("jsonwebtoken"), cors=require("cors"), axios=require("axios");
const app=express(); app.use(cors()); app.use(express.json());
const userSchema=new mongoose.Schema({fullName:{type:String,required:true,trim:true},email:{type:String,required:true,unique:true,lowercase:true,trim:true},password:{type:String,required:true},balance:{type:Number,default:0},role:{type:String,enum:["user","admin"],default:"user"}},{timestamps:true});
const User=mongoose.model("User",userSchema);
const serviceSchema=new mongoose.Schema({name:{type:String,required:true},platform:{type:String,required:true},description:String,pricePer1000:{type:Number,required:true,min:0},provider:{type:String,default:"manual"},providerServiceId:{type:Number},providerPricePer1000:{type:Number,min:0},boostType:{type:String},min:{type:Number,default:10},max:{type:Number,default:100000},active:{type:Boolean,default:true}},{timestamps:true});
const Service=mongoose.model("Service",serviceSchema);
const orderSchema=new mongoose.Schema({user:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true},service:{type:mongoose.Schema.Types.ObjectId,ref:"Service",required:false},serviceName:String,platform:String,link:String,quantity:Number,amount:Number,status:{type:String,enum:["Pending","Processing","Completed","Cancelled","Failed","Partial"],default:"Pending"},providerOrderId:String,boostType:String},{timestamps:true});
const Order=mongoose.model("Order",orderSchema);
const transactionSchema=new mongoose.Schema({user:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true},type:{type:String,enum:["deposit","admin_credit","admin_debit","order","refund"],required:true},amount:Number,balanceAfter:Number,reference:String,status:{type:String,default:"success"},note:String},{timestamps:true});
const Transaction=mongoose.model("Transaction",transactionSchema);
function token(user){return jwt.sign({id:user._id},process.env.JWT_SECRET,{expiresIn:"7d"});}
function auth(req,res,next){const h=req.headers.authorization;if(!h?.startsWith("Bearer "))return res.status(401).json({message:"Authentication required."});try{req.userId=jwt.verify(h.slice(7),process.env.JWT_SECRET).id;next();}catch{return res.status(401).json({message:"Invalid or expired token."});}}
async function admin(req,res,next){const u=await User.findById(req.userId);if(!u||u.role!=="admin")return res.status(403).json({message:"Admin access required."});req.admin=u;next();}
const money=n=>Math.round(Number(n)*100)/100;
const owletBase=String(process.env.OWLET_API_URL||"https://the-owlet.com/api/v2").replace(/\/$/,"");
async function owletRequest(payload){
 const key=String(process.env.OWLET_API_KEY||"").trim();
 if(!key) throw new Error("Owlet is not configured. Add OWLET_API_KEY to Backend/.env.");
 const response=await axios.post(owletBase,{key,...payload},{timeout:15000,headers:{"Content-Type":"application/json"}});
 const data=response.data;
 if(data?.error) throw new Error(typeof data.error==="string"?data.error:"Owlet API request failed.");
 return data;
}

async function sendWelcomeEmail(user){
 const apiKey=String(process.env.RESEND_API_KEY||"").trim();
 const from=String(process.env.RESEND_FROM||"").trim();
 if(!apiKey||!from){console.warn("Welcome email skipped: set RESEND_API_KEY and RESEND_FROM.");return false;}
 const safeName=String(user.fullName||"there").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 try{
  await axios.post("https://api.resend.com/emails",{
   from,to:[user.email],subject:"Welcome to PK-BOOSTER!",
   html:`<div style="margin:0;padding:32px 16px;background:#f8f5fc;font-family:Arial,sans-serif;color:#241b2d"><div style="max-width:560px;margin:auto;background:#fff;border-radius:18px;padding:32px"><div style="font-size:13px;font-weight:800;letter-spacing:2px;color:#7c3aed">PK-BOOSTER</div><h1 style="font-size:26px">Welcome, ${safeName}!</h1><p>Your account has been created successfully. You can now sign in, fund your wallet, and place social media boost orders.</p><p style="margin-top:28px">Thanks for joining PK-BOOSTER.</p></div></div>`,
   text:`Hi ${user.fullName}, welcome to PK-BOOSTER! Your account has been created successfully. You can now sign in and place social media boost orders.`
  },{timeout:10000,headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"}});
  return true;
 }catch(error){console.error("Welcome email failed:",error.response?.data||error.message);return false;}
}

function escapeEmailText(value){return String(value??"").replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;","'":"&#39;"}[c]));}
async function sendResendEmail({to,subject,title,message,details=[]}){
 const apiKey=String(process.env.RESEND_API_KEY||"").trim(),from=String(process.env.RESEND_FROM||"").trim();
 if(!apiKey||!from){console.warn("Resend email skipped: RESEND_API_KEY or RESEND_FROM is missing.");return false;}
 const safeTitle=escapeEmailText(title),safeMessage=escapeEmailText(message);
 const rows=details.filter(x=>x&&x.value!==undefined&&x.value!==null).map(x=>`<tr><td style=\"padding:8px 12px;color:#6b6472\">${escapeEmailText(x.label)}</td><td style=\"padding:8px 12px;font-weight:600\">${escapeEmailText(x.value)}</td></tr>`).join("");
 try{await axios.post("https://api.resend.com/emails",{from,to:[to],subject,html:`<div style=\"background:#f8f5fc;padding:28px 12px;font-family:Arial,sans-serif;color:#241b2d\"><div style=\"max-width:560px;margin:auto;background:#fff;border-radius:16px;padding:28px\"><div style=\"font-weight:800;letter-spacing:1px;color:#7c3aed\">PK-BOOSTER</div><h2>${safeTitle}</h2><p>${safeMessage}</p>${rows?`<table style=\"width:100%;border-collapse:collapse;margin-top:18px\">${rows}</table>`:""}<p style=\"margin-top:24px;color:#716879;font-size:13px\">Thank you for using PK-BOOSTER.</p></div></div>`,text:`${title}\n\n${message}\n${details.map(x=>`${x.label}: ${x.value}`).join("\n")}`},{timeout:10000,headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"}});return true;}catch(error){console.error("Resend notification failed:",error.response?.data||error.message);return false;}
}
async function sendLoginEmail(user){return sendResendEmail({to:user.email,subject:"New login to your PK-BOOSTER account",title:"Login successful",message:`Hi ${user.fullName}, you have successfully signed in to your PK-BOOSTER account. If this wasn't you, please secure your account.`});}
async function sendOrderPlacedEmail(user,order){return sendResendEmail({to:user.email,subject:"Your PK-BOOSTER order has been received",title:"Order received",message:`Hi ${user.fullName}, your boost order has been placed successfully.`,details:[{label:"Order",value:order._id},{label:"Service",value:order.serviceName},{label:"Platform",value:order.platform},{label:"Quantity",value:order.quantity},{label:"Amount",value:`₦${Number(order.amount||0).toLocaleString("en-NG")}`},{label:"Status",value:order.status}]});}
async function sendOrderCompletedEmail(user,order){return sendResendEmail({to:user.email,subject:"Your PK-BOOSTER order is completed",title:"Order completed",message:`Hi ${user.fullName}, your boost order has been marked as completed.`,details:[{label:"Order",value:order._id},{label:"Service",value:order.serviceName},{label:"Platform",value:order.platform},{label:"Quantity",value:order.quantity},{label:"Status",value:"Completed"}]});}

async function record(user,type,amount,note,reference){return Transaction.create({user:user._id,type,amount,balanceAfter:user.balance,note,reference});}
app.get("/",(req,res)=>res.json({message:"PK-BOOSTER API is running."}));
app.post("/register",async(req,res)=>{try{let {fullName,email,password}=req.body;if(!fullName||!email||!password)return res.status(400).json({message:"Full name, email, and password are required."});if(fullName.trim().length<2||password.length<8)return res.status(400).json({message:"Name must contain 2 characters and password at least 8."});email=email.trim().toLowerCase();if(await User.findOne({email}))return res.status(409).json({message:"Email already exists."});const role=process.env.ADMIN_EMAIL&&email===process.env.ADMIN_EMAIL.trim().toLowerCase()?"admin":"user";const user=await User.create({fullName:fullName.trim(),email,password:await bcrypt.hash(password,12),role});sendWelcomeEmail(user).catch(()=>{});res.status(201).json({message:"Account created.",user:{id:user._id,fullName:user.fullName,email:user.email,balance:user.balance,role:user.role}});}catch(e){res.status(500).json({message:"Unable to create account."});}});
app.post("/login",async(req,res)=>{try{const email=String(req.body.email||"").trim().toLowerCase(),password=String(req.body.password||"");const adminEmail=String(process.env.ADMIN_EMAIL||"").trim().toLowerCase(),adminPassword=String(process.env.ADMIN_PASSWORD||"");if(adminEmail&&adminPassword&&email===adminEmail&&password===adminPassword){let user=await User.findOne({email});if(!user){user=await User.create({fullName:process.env.ADMIN_NAME||"PK-BOOSTER Admin",email,password:await bcrypt.hash(adminPassword,12),role:"admin"});}else{user.role="admin";user.password=await bcrypt.hash(adminPassword,12);await user.save();}sendLoginEmail(user).catch(()=>{});return res.json({message:"Admin login successful.",token:token(user),user:{id:user._id,fullName:user.fullName,email:user.email,balance:user.balance,role:"admin"}});}const user=await User.findOne({email});if(!user||!await bcrypt.compare(password,user.password))return res.status(401).json({message:"Incorrect email or password."});sendLoginEmail(user).catch(()=>{});res.json({message:"Login successful.",token:token(user),user:{id:user._id,fullName:user.fullName,email:user.email,balance:user.balance,role:user.role}});}catch(e){res.status(500).json({message:"Unable to log in."});}});
app.get("/me",auth,async(req,res)=>{const user=await User.findById(req.userId).select("-password");if(!user)return res.status(404).json({message:"User not found."});res.json({user:{id:user._id,fullName:user.fullName,email:user.email,balance:user.balance,role:user.role}});});
app.get("/wallet",auth,async(req,res)=>{const user=await User.findById(req.userId).select("balance");if(!user)return res.status(404).json({message:"User not found."});const transactions=await Transaction.find({user:req.userId}).sort({createdAt:-1}).limit(100);res.json({balance:user.balance,referralEarnings:0,transactions});});

app.get("/provider/owlet/balance",auth,async(req,res)=>{try{const data=await owletRequest({action:"balance"});res.json(data);}catch(e){res.status(502).json({message:e.message||"Unable to retrieve Owlet balance."});}});
app.get("/provider/owlet/services",auth,async(req,res)=>{try{const data=await owletRequest({action:"services"});res.json({services:Array.isArray(data)?data:(data.services||[])});}catch(e){res.status(502).json({message:e.message||"Unable to retrieve Owlet services."});}});


const catalogCache={at:0,services:[]};
let catalogSyncPromise=null;
function inferOwletPlatform(item){
 const text=`${item.platform||""} ${item.category||""} ${item.name||""} ${item.description||""}`.toLowerCase();
 for(const [key,rx] of [["tiktok",/tik[\s-]?tok/],["instagram",/instagram/],["facebook",/facebook/],["youtube",/youtube/],["telegram",/telegram/],["whatsapp",/whatsapp/]])if(rx.test(text))return key[0].toUpperCase()+key.slice(1);
 return "";
}
function inferOwletBoost(item){
 const text=`${item.name||""} ${item.description||""} ${item.type||""}`.toLowerCase();
 if(/follower|follow/.test(text))return "Followers";
 if(/like/.test(text))return "Likes";
 if(/view|watch/.test(text))return "Views";
 if(/comment/.test(text))return "Comments";
 if(/subscriber/.test(text))return "Subscribers";
 if(/share/.test(text))return "Shares";
 return "Other";
}
async function syncOwletCatalog(){
 if(catalogSyncPromise)return catalogSyncPromise;
 if(Date.now()-catalogCache.at<5*60*1000&&catalogCache.services.length)return catalogCache.services;
 catalogSyncPromise=(async()=>{
  const data=await owletRequest({action:"services"});
  const raw=Array.isArray(data)?data:(Array.isArray(data.services)?data.services:[]);
  const normalized=raw.map(x=>{
   const id=Number(x.service||x.id),platform=inferOwletPlatform(x),boostType=inferOwletBoost(x);
   return {id,name:String(x.name||`Owlet service ${id}`),platform,boostType,rate:Number(x.rate||x.price||0),min:Number(x.min||1),max:Number(x.max||1000000)};
  }).filter(x=>Number.isInteger(x.id)&&x.id>0&&x.platform&&x.platform!=="Tiktok");
  // Batch writes so a large provider catalogue does not monopolize one database operation.
  for(let i=0;i<normalized.length;i+=300){
   const batch=normalized.slice(i,i+300);
   const ops=batch.map(x=>({updateOne:{filter:{provider:"owlet",providerServiceId:x.id},update:{$set:{name:x.name,platform:x.platform,boostType:x.boostType,provider:"owlet",providerServiceId:x.id,providerPricePer1000:x.rate,min:x.min,max:x.max},$setOnInsert:{pricePer1000:x.rate,active:true,description:"Automatically synced from Owlet"}},upsert:true}}));
   if(ops.length)await Service.bulkWrite(ops,{ordered:false});
  }
  catalogCache.at=Date.now();catalogCache.services=normalized;
  return normalized;
 })().catch(error=>{console.error("Owlet catalog sync failed:",error.message);throw error;}).finally(()=>{catalogSyncPromise=null;});
 return catalogSyncPromise;
}
function startOwletCatalogSync(){
 if(catalogSyncPromise||Date.now()-catalogCache.at<5*60*1000)return;
 syncOwletCatalog().catch(()=>{});
}
app.get("/services",async(req,res)=>{
 try{
  // Return the locally cached catalog immediately; refresh Owlet in the background.
  const fixed=[{id:8288,name:"Followers",type:"Followers"},{id:23425,name:"TikTok Followers",type:"Followers"},{id:21632,name:"TikTok Likes",type:"Likes"},{id:23148,name:"TikTok Views",type:"Views"},{id:20884,name:"TikTok Views",type:"Views"}];
  const fixedOps=fixed.map(x=>({updateOne:{filter:{provider:"owlet",providerServiceId:x.id},update:{$setOnInsert:{name:x.name,platform:"TikTok",boostType:x.type,description:"Existing TikTok Owlet service",provider:"owlet",providerServiceId:x.id,providerPricePer1000:0,pricePer1000:0,min:10,max:100000,active:true}},upsert:true}}));
  await Service.bulkWrite(fixedOps,{ordered:false});
  const services=await Service.find({active:true,provider:"owlet"}).sort({platform:1,name:1}).lean();
  res.json({services,refreshing:!catalogCache.at||Date.now()-catalogCache.at>5*60*1000});
  if(!catalogCache.at||Date.now()-catalogCache.at>5*60*1000){
   syncOwletCatalog(true).catch(e=>console.error("Background Owlet catalog refresh failed:",e.message));
  }
 }catch(e){console.error("Service list failed:",e.message);res.status(500).json({message:"Unable to load saved services."});}
});

app.post("/orders/owlet",auth,async(req,res)=>{
  let debitedUser=null,charge=0,serviceDoc=null;
  try{
    const providerServiceId=Number(req.body.service),quantity=Number(req.body.quantity),link=String(req.body.link||"").trim();
    if(!Number.isInteger(providerServiceId)||providerServiceId<=0||!Number.isInteger(quantity)||quantity<=0||!/^https?:\/\//i.test(link))
      return res.status(400).json({message:"Enter a valid service, quantity and target link."});
    serviceDoc=await Service.findOne({provider:"owlet",providerServiceId,active:true});
    if(!serviceDoc)return res.status(404).json({message:"This service is not enabled by the admin."});
    if(quantity<serviceDoc.min||quantity>serviceDoc.max)return res.status(400).json({message:`Quantity must be between ${serviceDoc.min} and ${serviceDoc.max}.`});
    charge=money(Number(serviceDoc.pricePer1000||0)*quantity/1000);
    // Atomically reserve the customer's balance so concurrent orders cannot overspend it.
    debitedUser=await User.findOneAndUpdate({_id:req.userId,balance:{$gte:charge}},{$inc:{balance:-charge}},{new:true});
    if(!debitedUser)return res.status(400).json({message:"Insufficient wallet balance.",charge});
    let providerResult;
    try{
      providerResult=await owletRequest({action:"add",service:providerServiceId,link,quantity});
      if(!providerResult||!providerResult.order)throw new Error("Owlet did not return an order ID.");
    }catch(providerError){
      const refunded=await User.findByIdAndUpdate(req.userId,{$inc:{balance:charge}},{new:true});
      if(refunded)await Transaction.create({user:refunded._id,type:"refund",amount:charge,balanceAfter:refunded.balance,note:"Automatic refund: provider order submission failed",reference:`owlet-failed-${providerServiceId}-${Date.now()}`});
      debitedUser=null;
      return res.status(502).json({message:providerError.message||"Unable to submit order. Your wallet was not charged."});
    }
    const order=await Order.create({user:debitedUser._id,service:serviceDoc._id,serviceName:serviceDoc.name,platform:serviceDoc.platform,boostType:String(req.body.boostType||serviceDoc.boostType||""),link,quantity,amount:charge,status:"Pending",providerOrderId:String(providerResult.order)});
    await record(debitedUser,"order",-charge,`Owlet order ${providerResult.order}`,`owlet-${providerResult.order}`);
    sendOrderPlacedEmail(debitedUser,order).catch(()=>{});
    res.status(201).json({message:"Order submitted successfully.",order,balance:debitedUser.balance,amount:charge});
  }catch(e){
    if(debitedUser){
      try{
        const refunded=await User.findByIdAndUpdate(req.userId,{$inc:{balance:charge}},{new:true});
        if(refunded)await Transaction.create({user:refunded._id,type:"refund",amount:charge,balanceAfter:refunded.balance,note:"Automatic refund: order could not be recorded",reference:`owlet-record-failed-${Date.now()}`});
      }catch(refundError){console.error("Order refund failed:",refundError.message);}
    }
    res.status(500).json({message:"Unable to place order. Please check your order history before trying again."});
  }
});app.get("/orders",auth,async(req,res)=>{try{
 const orders=await Order.find({user:req.userId}).sort({createdAt:-1});
 // Synchronize provider-owned orders with Owlet before returning the order list.
 for(const order of orders){
  if(!order.providerOrderId||["Completed","Cancelled","Failed"].includes(order.status))continue;
  try{
   const provider=await owletRequest({action:"status",order:order.providerOrderId});
   const raw=String(provider.status||"").toLowerCase();
   const mapped=raw.includes("complete")?"Completed":raw.includes("partial")?"Partial":raw.includes("cancel")?"Cancelled":raw.includes("fail")?"Failed":raw.includes("progress")||raw.includes("process")||raw.includes("in progress")?"Processing":"Pending";
   if(order.status!==mapped){const previousStatus=order.status;order.status=mapped;await order.save();if(mapped==="Completed"&&previousStatus!=="Completed"){const orderUser=await User.findById(order.user);if(orderUser)sendOrderCompletedEmail(orderUser,order).catch(()=>{});}}
  }catch(providerError){console.warn("Owlet status sync skipped for order",order.providerOrderId,providerError.message);}
 }
 res.json({orders:orders.map(order=>{const item=order.toObject?order.toObject():order;return {...item,id:String(item._id),service:item.serviceName||"Social media service",price:Number(item.amount||0),delivered:Number(item.delivered||0)};})});
 }catch(error){res.status(500).json({message:"Unable to load orders."});}});
app.post("/orders",auth,async(req,res)=>{
  let debited=null,amount=0;
  try{
    const {serviceId,link,quantity}=req.body,q=Number(quantity);
    const service=await Service.findOne({_id:serviceId,active:true});
    if(!service)return res.status(404).json({message:"Service not found."});
    if(!link||!/^https?:\/\//i.test(String(link))||!Number.isInteger(q)||q<service.min||q>service.max)return res.status(400).json({message:`Quantity must be between ${service.min} and ${service.max}.`});
    amount=money(q*Number(service.pricePer1000||0)/1000);
    debited=await User.findOneAndUpdate({_id:req.userId,balance:{$gte:amount}},{$inc:{balance:-amount}},{new:true});
    if(!debited)return res.status(400).json({message:"Insufficient wallet balance.",amount});
    let providerOrderId;
    if(service.provider==="owlet"&&service.providerServiceId){
      try{const result=await owletRequest({action:"add",service:service.providerServiceId,link,quantity:q});if(!result?.order)throw new Error("Owlet did not return an order ID.");providerOrderId=String(result.order);}
      catch(providerError){const refunded=await User.findByIdAndUpdate(req.userId,{$inc:{balance:amount}},{new:true});if(refunded)await Transaction.create({user:refunded._id,type:"refund",amount,balanceAfter:refunded.balance,note:"Automatic refund: provider order submission failed",reference:`order-failed-${Date.now()}`});debited=null;return res.status(502).json({message:providerError.message||"Order failed. Your wallet was not charged."});}
    }
    const order=await Order.create({user:debited._id,service:service._id,serviceName:service.name,platform:service.platform,boostType:service.boostType||"",link,quantity:q,amount,status:"Pending",providerOrderId});
    await record(debited,"order",-amount,`Order ${order._id}`);
    sendOrderPlacedEmail(debited,order).catch(()=>{});
    res.status(201).json({message:"Order placed successfully.",order,balance:debited.balance,amount});
  }catch(e){
    if(debited){try{const refunded=await User.findByIdAndUpdate(req.userId,{$inc:{balance:amount}},{new:true});if(refunded)await Transaction.create({user:refunded._id,type:"refund",amount,balanceAfter:refunded.balance,note:"Automatic refund: order could not be recorded",reference:`order-record-failed-${Date.now()}`});}catch(refundError){console.error("Order refund failed:",refundError.message);}}
    res.status(500).json({message:"Unable to place order. Please check your order history before trying again."});
  }
});
app.get("/orders/owlet/:providerOrderId/status",auth,async(req,res)=>{try{const order=await Order.findOne({user:req.userId,providerOrderId:String(req.params.providerOrderId)});if(!order)return res.status(404).json({message:"Order not found."});const data=await owletRequest({action:"status",order:order.providerOrderId});const raw=String(data.status||"").toLowerCase();const mapped=raw.includes("complete")?"Completed":raw.includes("partial")?"Partial":raw.includes("cancel")?"Cancelled":raw.includes("fail")?"Failed":raw.includes("progress")||raw.includes("process")?"Processing":"Pending";if(order.status!==mapped){const previousStatus=order.status;order.status=mapped;await order.save();if(mapped==="Completed"&&previousStatus!=="Completed"){const orderUser=await User.findById(order.user);if(orderUser)sendOrderCompletedEmail(orderUser,order).catch(()=>{});}}res.json({provider:data,order});}catch(e){res.status(502).json({message:e.message||"Unable to retrieve order status."});}});
app.get("/transactions",auth,async(req,res)=>res.json({transactions:await Transaction.find({user:req.userId}).sort({createdAt:-1}).limit(100)}));
app.post("/payments/initialize",auth,async(req,res)=>{try{const amount=money(Number(req.body.amount));if(!Number.isFinite(amount)||amount<100)return res.status(400).json({message:"Minimum deposit is ₦100."});if(!process.env.PAYSTACK_SECRET_KEY)return res.status(503).json({message:"Paystack is not configured. Add PAYSTACK_SECRET_KEY to Backend/.env."});const user=await User.findById(req.userId);const reference=`PKB-${user._id}-${Date.now()}`;const r=await axios.post("https://api.paystack.co/transaction/initialize",{email:user.email,amount:Math.round(amount*100),reference,callback_url:(typeof req.body.callback_url==="string"&&/^https?:\/\//i.test(req.body.callback_url)?req.body.callback_url:process.env.PAYSTACK_CALLBACK_URL)||undefined,metadata:{userId:String(user._id)},channels:["card","bank","ussd","qr","mobile_money","bank_transfer"]},{headers:{Authorization:`Bearer ${process.env.PAYSTACK_SECRET_KEY}`}});res.json({authorization_url:r.data.data.authorization_url,reference});}catch(e){res.status(502).json({message:e.response?.data?.message||"Unable to initialize Paystack payment."});}});
async function verifyAndCreditPaystack(ref,expectedUserId){
 const r=await axios.get(`https://api.paystack.co/transaction/verify/${encodeURIComponent(ref)}`,{timeout:15000,headers:{Authorization:`Bearer ${process.env.PAYSTACK_SECRET_KEY}`}});
 const data=r.data?.data;
 if(!data||data.status!=="success"||!data.amount||data.currency!=="NGN")throw new Error("Paystack has not confirmed a successful NGN payment.");
 const metadataUser=String(data.metadata?.userId||"");
 const user=await User.findById(expectedUserId||metadataUser);
 if(!user||String(user._id)!==metadataUser)throw new Error("Payment does not belong to this account.");
 const existing=await Transaction.findOne({reference:ref});
 if(existing)return {credited:false,balance:user.balance,message:"Deposit already credited."};
 const amount=money(Number(data.amount)/100);
 user.balance=money(user.balance+amount);await user.save();
 await record(user,"deposit",amount,"Paystack deposit",ref);
 return {credited:true,balance:user.balance,message:"Deposit successful."};
}
app.get("/payments/verify/:reference",auth,async(req,res)=>{try{if(!process.env.PAYSTACK_SECRET_KEY)return res.status(503).json({message:"Paystack is not configured."});const result=await verifyAndCreditPaystack(req.params.reference,req.userId);res.json(result);}catch(e){res.status(400).json({message:e.response?.data?.message||e.message||"Unable to verify payment."});}});
app.post("/payments/webhook",async(req,res)=>{try{const signature=req.headers["x-paystack-signature"];const crypto=require("crypto");const expected=crypto.createHmac("sha512",process.env.PAYSTACK_SECRET_KEY||"").update(JSON.stringify(req.body)).digest("hex");if(!signature||signature!==expected)return res.status(401).send("Invalid signature");if(req.body?.event==="charge.success"){const ref=req.body.data?.reference;const uid=req.body.data?.metadata?.userId;if(ref&&uid)await verifyAndCreditPaystack(ref,uid);}res.sendStatus(200);}catch(e){console.error("Paystack webhook:",e.message);res.sendStatus(500);}});
app.get("/admin/overview",auth,admin,async(req,res)=>{const [users,orders,services,pending,completed,failed,revenue,deposits]=await Promise.all([User.countDocuments(),Order.countDocuments(),Service.countDocuments(),Order.countDocuments({status:"Pending"}),Order.countDocuments({status:"Completed"}),Order.countDocuments({status:"Failed"}),Transaction.aggregate([{ $match:{type:"order",amount:{ $lt:0 }}},{ $group:{_id:null,total:{ $sum:{ $abs:"$amount" }}}}]),Transaction.aggregate([{ $match:{type:"deposit",amount:{ $gt:0 }}},{ $group:{_id:null,total:{ $sum:"$amount" }}}])]);res.json({users,orders,services,pending,completed,failed,revenue:money(revenue[0]?.total||0),deposits:money(deposits[0]?.total||0)});});
app.get("/admin/users",auth,admin,async(req,res)=>res.json({users:await User.find().select("-password").sort({createdAt:-1})}));
app.post("/admin/users/:id/adjust-balance",auth,admin,async(req,res)=>{try{const amount=money(Number(req.body.amount)),type=req.body.action;if(!Number.isFinite(amount)||amount<=0||!["credit","debit"].includes(type))return res.status(400).json({message:"Enter a valid amount and action."});const u=await User.findById(req.params.id);if(!u)return res.status(404).json({message:"User not found."});if(type==="debit"&&u.balance<amount)return res.status(400).json({message:"User has insufficient balance."});u.balance=money(u.balance+(type==="credit"?amount:-amount));await u.save();await record(u,type==="credit"?"admin_credit":"admin_debit",type==="credit"?amount:-amount,`Admin ${type}: ${req.body.note||"Balance adjustment"}`);res.json({message:`User balance ${type}ed successfully.`,user:{id:u._id,email:u.email,balance:u.balance}});}catch(e){res.status(500).json({message:"Unable to adjust balance."});}});
app.get("/admin/orders",auth,admin,async(req,res)=>res.json({orders:await Order.find().populate("user","fullName email").sort({createdAt:-1})}));
app.patch("/admin/orders/:id",auth,admin,async(req,res)=>{const allowed=["Pending","Processing","Completed","Partial","Cancelled","Failed"];if(!allowed.includes(req.body.status))return res.status(400).json({message:"Invalid status."});const order=await Order.findById(req.params.id);if(!order)return res.status(404).json({message:"Order not found."});const previousStatus=order.status;order.status=req.body.status;await order.save();if(order.status==="Completed"&&previousStatus!=="Completed"){const orderUser=await User.findById(order.user);if(orderUser)sendOrderCompletedEmail(orderUser,order).catch(()=>{});}res.json({message:"Order updated.",order});});
app.get("/admin/provider/owlet/services",auth,admin,async(req,res)=>{
 try{
  // Respond from MongoDB immediately; never make the admin page wait for Owlet.
  const saved=await Service.find({provider:"owlet",platform:{$ne:"TikTok"}}).sort({platform:1,name:1}).lean();
  const services=saved.map(local=>({providerServiceId:Number(local.providerServiceId),name:local.name,providerPricePer1000:Number(local.providerPricePer1000||0),min:local.min,max:local.max,platform:local.platform,boostType:local.boostType||inferOwletBoost(local),localId:String(local._id),pricePer1000:Number(local.pricePer1000),active:!!local.active}));
  const refreshing=!!catalogSyncPromise||(!catalogCache.at||Date.now()-catalogCache.at>5*60*1000);
  res.json({services,refreshing});
  if(refreshing)startOwletCatalogSync();
 }catch(e){console.error("Admin saved provider services failed:",e.message);res.status(500).json({message:"Unable to load saved services."});}
});
app.post("/admin/provider/owlet/services",auth,admin,async(req,res)=>{try{
 const id=Number(req.body.providerServiceId),price=Number(req.body.pricePer1000);
 if(!Number.isInteger(id)||id<=0||!Number.isFinite(price)||price<0)return res.status(400).json({message:"Enter a valid provider service ID and selling price."});
 let service=await Service.findOne({provider:"owlet",providerServiceId:id});
 if(!service){
  // A just-fetched service may be in the sync queue; don't block this request on another Owlet call.
  return res.status(409).json({message:"Service catalog is still loading. Refresh the list and try again."});
 }
 service.pricePer1000=price;service.active=req.body.active!==false;await service.save();
 res.json({message:"Provider service and selling price saved.",service});
 }catch(e){res.status(500).json({message:e.message||"Unable to save provider service."});}});
app.post("/admin/services",auth,admin,async(req,res)=>{try{const {name,platform,pricePer1000,min,max,description}=req.body;if(!name||!platform||Number(pricePer1000)<0)return res.status(400).json({message:"Name, platform, and valid price are required."});const service=await Service.create({name,platform,pricePer1000:Number(pricePer1000),min:Number(min)||10,max:Number(max)||100000,description});res.status(201).json({service});}catch(e){res.status(500).json({message:"Unable to create service."});}});
app.patch("/admin/services/:id",auth,admin,async(req,res)=>{const service=await Service.findByIdAndUpdate(req.params.id,req.body,{new:true,runValidators:true});if(!service)return res.status(404).json({message:"Service not found."});res.json({service});});
app.get("/admin/transactions",auth,admin,async(req,res)=>res.json({transactions:await Transaction.find().populate("user","fullName email").sort({createdAt:-1}).limit(300)}));
app.post("/logout",(req,res)=>res.json({message:"Logged out. Remove your token from browser storage."}));
async function start(){try{if(!process.env.MONGODB_URI||!process.env.JWT_SECRET)throw Error("MONGODB_URI and JWT_SECRET are required.");dns.setServers(["8.8.8.8","8.8.4.4"]);await mongoose.connect(process.env.MONGODB_URI);console.log("MongoDB connected.");app.listen(process.env.PORT||5000,()=>console.log(`PK-BOOSTER API running on ${process.env.PORT||5000}`));}catch(e){console.error("Startup error:",e.message);process.exit(1);}}
start();
