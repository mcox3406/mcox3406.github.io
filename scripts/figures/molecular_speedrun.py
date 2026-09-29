"""Plot development targets only; usage: python molecular_speedrun.py DATA_DIR OUTPUT.svg."""
import csv,json,sys,hashlib
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
root=Path(sys.argv[1]);out=Path(sys.argv[2]);data={}
for name in ['train','validation']:
 rows=list(csv.DictReader((root/f'{name}.csv').open()))
 data[name]=np.asarray([[float(r['S1_eV']),float(r['f_S1'])] for r in rows])
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':11,'axes.spines.top':False,'axes.spines.right':False,'svg.fonttype':'none'})
fig,axes=plt.subplots(1,2,figsize=(10,3.4),layout='constrained')
colors={'train':'#276c9b','validation':'#d57830'}
for name,v in data.items():
 label=f'{name.title()} · {len(v):,}'
 axes[0].hist(v[:,0],bins=np.linspace(0,max(x[:,0].max() for x in data.values()),65),density=True,histtype='step',linewidth=1.8,color=colors[name],label=label)
 axes[1].hist(np.log10(1+v[:,1]/.001),bins=np.linspace(0,max(np.log10(1+x[:,1]/.001).max() for x in data.values()),60),weights=np.ones(len(v))/len(v)*100,histtype='step',linewidth=1.8,color=colors[name])
axes[0].set(xlabel='Lowest singlet excitation energy (eV)',ylabel='Density',title='Excitation energies')
axes[0].legend(frameon=False,fontsize=9)
ticks=np.asarray([0,.001,.01,.1,1,10]);ticks=ticks[ticks<=max(x[:,1].max() for x in data.values())]
axes[1].set_xticks(np.log10(1+ticks/.001),[f'{t:g}' for t in ticks]);axes[1].set(xlabel='Oscillator strength f (nonlinear scale)',ylabel='Molecules per bin (%)',title='Absorption strength')
for ax in axes:ax.grid(axis='y',alpha=.15);ax.set_axisbelow(True)
out.parent.mkdir(parents=True,exist_ok=True);fig.savefig(out,metadata={'Date':None});fig.savefig(out.with_suffix('.png'),dpi=170);plt.close(fig)
summary={'source_manifest_sha256':hashlib.sha256((root/'manifest.json').read_bytes()).hexdigest(),'scope':'training and validation only; reserve excluded','oscillator_axis':'log10(1+f/0.001)','cohorts':{k:{'n':len(v),'S1_eV_quantiles':np.quantile(v[:,0],[0,.05,.5,.95,1]).tolist(),'f_quantiles':np.quantile(v[:,1],[0,.5,.9,.99,1]).tolist(),'zero_f_fraction':float(np.mean(v[:,1]==0)),'bright_f_ge_01_fraction':float(np.mean(v[:,1]>=.1))} for k,v in data.items()}}
out.with_suffix('.json').write_text(json.dumps(summary,indent=2)+'\n')
