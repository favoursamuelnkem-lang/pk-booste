require("dotenv").config();
const dns=require("dns"), express=require("express"), mongoose=require("mongoose"), bcrypt=require("bcryptjs"), jwt=require("jsonwebtoken"), cors=require("cors"), axios=require("axios");
const app=express(); app.use(cors()); app.use(express.json());
const userSchema=new mongoose.Schema({fullName:{type:String,required:true,trim:true},email:{type:String,required:true,unique:true,lowercase:true,trim:true},password:{type:String,required:true},balance:{type:Number,default:0},role:{type:String,enum:["user","admin"],default:"user"}},{timestamps:true});
const User=mongoose.model("User",userSchema);
const serviceSchema=new mongoose.Schema({name:{type:String,required:true},platform:{type:String,required:true},description:String,pricePer1000:{type:Number,required:true,min:0},min:{type:Number,default:10},max:{type:Number,default:100000},active:{type:Boolean,default:true}},{timestamps:true});
const Service=mongoose.model("Service",serviceSchema);
const orderSchema=new mongoose.Schema({user:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true},service:{type:mongoose.Schema.Types.ObjectId,ref:"Service",required:true},serviceName:String,platform:String,link:String,quantity:Number,amount:Number,status:{type:String,enum:["Pending","Processing","Completed","Cancelled","Failed"],default:"Pending"},providerOrderId:String},{timestamps:true});
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
 const response=await axios.post(owletBase,{key,...payload},{timeout:20000,headers:{"Content-Type":"application/json"}});
 const data=response.data;
 if(data?.error) throw new Error(typeof data.error==="string"?data.error:"Owlet API request failed.");
 return data;
}

async function record(user,type,amount,note,reference){return Transaction.create({user:user._id,type,amount,balanceAfter:user.balance,note,reference});}
app.get("/",(req,res)=>res.json({message:"PK-BOOSTER API is running."}));
app.post("/register",async(req,res)=>{try{let {fullName,email,password}=req.body;if(!fullName||!email||!password)return res.status(400).json({message:"Full name, email, and password are required."});if(fullName.trim().length<2||password.length<8)return res.status(400).json({message:"Name must contain 2 characters and password at least 8."});email=email.trim().toLowerCase();if(await User.findOne({email}))return res.status(409).json({message:"Email already exists."});const role=process.env.ADMIN_EMAIL&&email===process.env.ADMIN_EMAIL.trim().toLowerCase()?"admin":"user";const user=await User.create({fullName:fullName.trim(),email,password:await bcrypt.hash(password,12),role});res.status(201).json({message:"Account created.",user:{id:user._id,fullName:user.fullName,email:user.email,balance:user.balance,role:user.role}});}catch(e){res.status(500).json({message:"Unable to create account."});}});
app.post("/login",async(req,res)=>{try{const email=String(req.body.email||"").trim().toLowerCase(),password=String(req.body.password||"");const adminEmail=String(process.env.ADMIN_EMAIL||"").trim().toLowerCase(),adminPassword=String(process.env.ADMIN_PASSWORD||"");if(adminEmail&&adminPassword&&email===adminEmail&&password===adminPassword){let user=await User.findOne({email});if(!user){user=await User.create({fullName:process.env.ADMIN_NAME||"PK-BOOSTER Admin",email,password:await bcrypt.hash(adminPassword,12),role:"admin"});}else{user.role="admin";user.password=await bcrypt.hash(adminPassword,12);await user.save();}return res.json({message:"Admin login successful.",token:token(user),user:{id:user._id,fullName:user.fullName,email:user.email,balance:user.balance,role:"admin"}});}const user=await User.findOne({email});if(!user||!await bcrypt.compare(password,user.password))return res.status(401).json({message:"Incorrect email or password."});res.json({message:"Login successful.",token:token(user),user:{id:user._id,fullName:user.fullName,email:user.email,balance:user.balance,role:user.role}});}catch(e){res.status(500).json({message:"Unable to log in."});}});
app.get("/me",auth,async(req,res)=>{const user=await User.findById(req.userId).select("-password");if(!user)return res.status(404).json({message:"User not found."});res.json({user:{id:user._id,fullName:user.fullName,email:user.email,balance:user.balance,role:user.role}});});
app.get("/wallet",auth,async(req,res)=>{const user=await User.findById(req.userId).select("balance");if(!user)return res.status(404).json({message:"User not found."});const transactions=await Transaction.find({user:req.userId}).sort({createdAt:-1}).limit(100);res.json({balance:user.balance,referralEarnings:0,transactions});});

app.get("/provider/owlet/balance",auth,async(req,res)=>{try{const data=await owletRequest({action:"balance"});res.json(data);}catch(e){res.status(502).json({message:e.message||"Unable to retrieve Owlet balance."});}});
app.get("/provider/owlet/services",auth,async(req,res)=>{try{const data=await owletRequest({action:"services"});res.json({services:Array.isArray(data)?data:(data.services||[])});}catch(e){res.status(502).json({message:e.message||"Unable to retrieve Owlet services."});}});

app.get("/services",async(req,res)=>res.json({services:await Service.find({active:true}).sort({platform:1,name:1})}));

app.post("/orders/owlet",auth,async(req,res)=>{try{
 const service=Number(req.body.service),quantity=Number(req.body.quantity),link=String(req.body.link||"").trim();
 if(!Number.isInteger(service)||service<=0||!Number.isInteger(quantity)||quantity<=0||!link)return res.status(400).json({message:"Valid service ID, link, and quantity are required."});
 const optional=["target","gender","region","comments","comment_gender","comment_instructions","duration","start_count","start_screenshot"];
 const payload={action:"add",service,link,quantity};
 for(const field of optional){const value=req.body[field];if(value!==undefined&&value!==null&&String(value).trim()!=="")payload[field]=value;}
 const u=await User.findById(req.userId);if(!u)return res.status(404).json({message:"User not found."});
 const catalog=await owletRequest({action:"services"});
 const list=Array.isArray(catalog)?catalog:(catalog.services||[]);
 const selected=list.find(item=>Number(item.service)===service);
 if(!selected)return res.status(404).json({message:"Owlet service was not found in its service list."});
 const rate=Number(selected.rate);
 if(!Number.isFinite(rate)||rate<0)return res.status(502).json({message:"Owlet returned an invalid service rate."});
 const markup=Math.max(0,Number(process.env.OWLET_MARKUP_PERCENT||0));
 const charge=money(rate*quantity/1000*(1+markup/100));
 if(u.balance<charge)return res.status(400).json({message:"Insufficient wallet balance.",charge});
 const providerResult=await owletRequest(payload);
 if(!providerResult.order)return res.status(502).json({message:"Owlet did not return an order ID.",provider:providerResult});
 u.balance=money(u.balance-charge);await u.save();
 const order=await Order.create({user:u._id,service:new mongoose.Types.ObjectId(),serviceName:String(req.body.serviceName||`Owlet service ${service}`),platform:String(req.body.platform||"Social media"),link,quantity,amount:charge,status:"Processing",providerOrderId:String(providerResult.order)});
 await record(u,"order",-charge,`Owlet order ${providerResult.order}`,`owlet-${providerResult.order}`);
 res.status(201).json({message:"Owlet order submitted.",order,balance:u.balance,provider:providerResult});
 }catch(e){res.status(502).json({message:e.message||"Unable to submit Owlet order."});}});

app.get("/orders",auth,async(req,res)=>res.json({orders:await Order.find({user:req.userId}).sort({createdAt:-1})}));
app.post("/orders",auth,async(req,res)=>{try{const {serviceId,link,quantity}=req.body;const q=Number(quantity),s=await Service.findOne({_id:serviceId,active:true}),u=await User.findById(req.userId);if(!s)return res.status(404).json({message:"Service not found."});if(!link||!Number.isInteger(q)||q<s.min||q>s.max)return res.status(400).json({message:`Quantity must be between ${s.min} and ${s.max}.`});const amount=money(q*s.pricePer1000/1000);if(u.balance<amount)return res.status(400).json({message:"Insufficient wallet balance."});u.balance=money(u.balance-amount);await u.save();const order=await Order.create({user:u._id,service:s._id,serviceName:s.name,platform:s.platform,link,quantity:q,amount});await record(u,"order",-amount,`Order ${order._id}`);res.status(201).json({message:"Order placed.",order,balance:u.balance});}catch(e){res.status(500).json({message:"Unable to place order."});}});
app.get("/orders/owlet/:providerOrderId/status",auth,async(req,res)=>{try{const data=await owletRequest({action:"status",order:req.params.providerOrderId});res.json(data);}catch(e){res.status(502).json({message:e.message||"Unable to retrieve order status."});}});
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
app.get("/admin/overview",auth,admin,async(req,res)=>{const [users,orders,services,pending]=await Promise.all([User.countDocuments(),Order.countDocuments(),Service.countDocuments(),Order.countDocuments({status:"Pending"})]);res.json({users,orders,services,pending});});
app.get("/admin/users",auth,admin,async(req,res)=>res.json({users:await User.find().select("-password").sort({createdAt:-1})}));
app.post("/admin/users/:id/adjust-balance",auth,admin,async(req,res)=>{try{const amount=money(Number(req.body.amount)),type=req.body.action;if(!Number.isFinite(amount)||amount<=0||!["credit","debit"].includes(type))return res.status(400).json({message:"Enter a valid amount and action."});const u=await User.findById(req.params.id);if(!u)return res.status(404).json({message:"User not found."});if(type==="debit"&&u.balance<amount)return res.status(400).json({message:"User has insufficient balance."});u.balance=money(u.balance+(type==="credit"?amount:-amount));await u.save();await record(u,type==="credit"?"admin_credit":"admin_debit",type==="credit"?amount:-amount,`Admin ${type}: ${req.body.note||"Balance adjustment"}`);res.json({message:`User balance ${type}ed successfully.`,user:{id:u._id,email:u.email,balance:u.balance}});}catch(e){res.status(500).json({message:"Unable to adjust balance."});}});
app.get("/admin/orders",auth,admin,async(req,res)=>res.json({orders:await Order.find().populate("user","fullName email").sort({createdAt:-1})}));
app.patch("/admin/orders/:id",auth,admin,async(req,res)=>{const allowed=["Pending","Processing","Completed","Cancelled","Failed"];if(!allowed.includes(req.body.status))return res.status(400).json({message:"Invalid status."});const order=await Order.findByIdAndUpdate(req.params.id,{status:req.body.status},{new:true});if(!order)return res.status(404).json({message:"Order not found."});res.json({message:"Order updated.",order});});
app.post("/admin/services",auth,admin,async(req,res)=>{try{const {name,platform,pricePer1000,min,max,description}=req.body;if(!name||!platform||Number(pricePer1000)<0)return res.status(400).json({message:"Name, platform, and valid price are required."});const service=await Service.create({name,platform,pricePer1000:Number(pricePer1000),min:Number(min)||10,max:Number(max)||100000,description});res.status(201).json({service});}catch(e){res.status(500).json({message:"Unable to create service."});}});
app.patch("/admin/services/:id",auth,admin,async(req,res)=>{const service=await Service.findByIdAndUpdate(req.params.id,req.body,{new:true,runValidators:true});if(!service)return res.status(404).json({message:"Service not found."});res.json({service});});
app.get("/admin/transactions",auth,admin,async(req,res)=>res.json({transactions:await Transaction.find().populate("user","fullName email").sort({createdAt:-1}).limit(300)}));
app.post("/logout",(req,res)=>res.json({message:"Logged out. Remove your token from browser storage."}));
async function start(){try{if(!process.env.MONGODB_URI||!process.env.JWT_SECRET)throw Error("MONGODB_URI and JWT_SECRET are required.");dns.setServers(["8.8.8.8","8.8.4.4"]);await mongoose.connect(process.env.MONGODB_URI);console.log("MongoDB connected.");app.listen(process.env.PORT||5000,()=>console.log(`PK-BOOSTER API running on ${process.env.PORT||5000}`));}catch(e){console.error("Startup error:",e.message);process.exit(1);}}
start();
