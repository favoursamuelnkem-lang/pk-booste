(function(){
 const symbols={success:"✓",error:"×",info:"i",warning:"!"};
 function toast(message,type="info",duration=4200){
  type=["success","error","info","warning"].includes(type)?type:"info";
  let container=document.getElementById("pk-toast-container");
  if(!container){container=document.createElement("div");container.id="pk-toast-container";container.setAttribute("aria-live","polite");container.setAttribute("aria-atomic","false");document.body.appendChild(container);}
  const item=document.createElement("div");item.className="pk-toast pk-toast-"+type;item.setAttribute("role",type==="error"?"alert":"status");
  const icon=document.createElement("span");icon.className="pk-toast-icon";icon.textContent=symbols[type];
  const text=document.createElement("span");text.className="pk-toast-message";text.textContent=String(message??"");
  const close=document.createElement("button");close.className="pk-toast-close";close.type="button";close.setAttribute("aria-label","Dismiss notification");close.textContent="×";
  item.append(icon,text,close);container.appendChild(item);
  let timer=setTimeout(remove,duration);function remove(){clearTimeout(timer);item.style.animation="pkToastOut .18s ease-in forwards";setTimeout(()=>item.remove(),180);}
  close.addEventListener("click",remove);return item;
 }
 window.showToast=toast;window.toastSuccess=(m,d)=>toast(m,"success",d);window.toastError=(m,d)=>toast(m,"error",d);window.toastInfo=(m,d)=>toast(m,"info",d);window.toastWarning=(m,d)=>toast(m,"warning",d);
 // Legacy alert calls become non-blocking error toasts.
 window.alert=function(message){toast(message,"error");};
})();